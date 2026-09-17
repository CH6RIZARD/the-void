import Foundation
import CoreBluetooth

/// Latest BLE heart-rate reading (device-local; only device status goes to JS).
struct BleHeartReading {
    let bpm: Double
    let rmssdMs: Double?
    let contact: Bool
    let sampleMs: Int64
}

/// Standard Bluetooth LE Heart Rate Service (0x180D) client: scan, connect, subscribe to
/// Heart Rate Measurement (0x2A37), parse bpm + RR intervals, compute RMSSD.
/// The CBCentralManager (and thus the Bluetooth permission prompt) is created only
/// when this object is constructed, i.e. only when the ble tier is requested.
final class BleHeartRate: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let heartRateService = CBUUID(string: "180D")
    static let heartRateMeasurement = CBUUID(string: "2A37")
    private static let savedDeviceKey = "com.thevoid.sensing.ble.deviceId"

    /// Status / discovery events: {id, name, rssi?, state, connected}.
    var onDevice: (([String: Any]) -> Void)?

    private let queue = DispatchQueue(label: "com.thevoid.sensing.ble")
    private var central: CBCentralManager!

    // queue state
    private var discovered: [UUID: CBPeripheral] = [:]
    private var connected: CBPeripheral?
    private var pendingScan = false
    private var pendingConnect: UUID?
    private var userDisconnected = false
    private var scanStopWork: DispatchWorkItem?

    // lock-guarded reading state
    private let lock = NSLock()
    private var lastBpm: Double = 0
    private var lastContact = true
    private var lastSampleMs: Int64 = 0
    private var connectedFlag = false
    private var rrLog: [(t: Int64, rr: Double)] = []

    static var isDenied: Bool {
        let a = CBManager.authorization
        return a == .denied || a == .restricted
    }

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: queue,
                                   options: [CBCentralManagerOptionShowPowerAlertKey: false])
    }

    var isConnected: Bool {
        lock.lock()
        defer { lock.unlock() }
        return connectedFlag
    }

    private func setConnectedFlag(_ v: Bool) {
        lock.lock()
        connectedFlag = v
        lock.unlock()
    }

    // MARK: - Public API (any thread)

    func scan(seconds: Double = 15) {
        queue.async { [weak self] in
            guard let self = self else { return }
            guard self.central.state == .poweredOn else {
                self.pendingScan = true
                self.emitState(self.central)
                return
            }
            self.startScanLocked(seconds: seconds)
        }
    }

    func connect(id: String) -> Bool {
        guard let uuid = UUID(uuidString: id) else { return false }
        UserDefaults.standard.set(id, forKey: BleHeartRate.savedDeviceKey)
        queue.async { [weak self] in
            guard let self = self else { return }
            self.userDisconnected = false
            guard self.central.state == .poweredOn else {
                self.pendingConnect = uuid
                return
            }
            self.connectLocked(uuid)
        }
        return true
    }

    /// Reconnects the last user-selected device, if any.
    func reconnectSaved() {
        guard let id = UserDefaults.standard.string(forKey: BleHeartRate.savedDeviceKey) else { return }
        _ = connect(id: id)
    }

    func disconnect(forget: Bool) {
        if forget { UserDefaults.standard.removeObject(forKey: BleHeartRate.savedDeviceKey) }
        queue.async { [weak self] in
            guard let self = self else { return }
            self.userDisconnected = true
            self.pendingConnect = nil
            if self.central.isScanning { self.central.stopScan() }
            if let p = self.connected {
                self.central.cancelPeripheralConnection(p)
            }
        }
        lock.lock()
        lastSampleMs = 0
        rrLog.removeAll()
        lock.unlock()
    }

    func latest(maxAgeSec: Double) -> BleHeartReading? {
        let now = vsNowMs()
        lock.lock()
        defer { lock.unlock() }
        guard lastSampleMs > 0, Double(now - lastSampleMs) <= maxAgeSec * 1000.0, lastBpm > 0 else { return nil }
        let recent = rrLog.filter { now - $0.t <= 60_000 }.map { $0.rr }
        let rm = DSP.rmssd(Array(recent.suffix(60)), minRR: 300, maxRR: 2000)
        return BleHeartReading(bpm: lastBpm, rmssdMs: rm, contact: lastContact, sampleMs: lastSampleMs)
    }

    // MARK: - Internals (queue)

    private func startScanLocked(seconds: Double) {
        pendingScan = false
        // Devices already connected at the OS level (e.g. paired straps) first.
        for p in central.retrieveConnectedPeripherals(withServices: [BleHeartRate.heartRateService]) {
            discovered[p.identifier] = p
            emit(p, rssi: nil, state: "discovered")
        }
        central.scanForPeripherals(withServices: [BleHeartRate.heartRateService],
                                   options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        scanStopWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            if self.central.isScanning { self.central.stopScan() }
            self.onDevice?(["state": "scanComplete", "connected": self.connected?.state == .connected])
        }
        scanStopWork = work
        queue.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func connectLocked(_ uuid: UUID) {
        pendingConnect = nil
        var peripheral = discovered[uuid]
        if peripheral == nil {
            peripheral = central.retrievePeripherals(withIdentifiers: [uuid]).first
        }
        guard let p = peripheral else {
            onDevice?(["id": uuid.uuidString, "state": "notFound", "connected": false])
            return
        }
        discovered[uuid] = p
        if let current = connected, current.identifier != uuid {
            central.cancelPeripheralConnection(current)
        }
        connected = p
        p.delegate = self
        central.connect(p, options: nil)
        emit(p, rssi: nil, state: "connecting")
    }

    private func emit(_ p: CBPeripheral, rssi: NSNumber?, state: String, name: String? = nil) {
        var d: [String: Any] = [
            "id": p.identifier.uuidString,
            "name": name ?? p.name ?? "Heart rate monitor",
            "state": state,
            "connected": p.state == .connected,
        ]
        if let r = rssi { d["rssi"] = r.intValue }
        onDevice?(d)
    }

    private func emitState(_ manager: CBCentralManager) {
        let s: String
        switch manager.state {
        case .poweredOn: s = "poweredOn"
        case .poweredOff: s = "poweredOff"
        case .unauthorized: s = "unauthorized"
        case .unsupported: s = "unsupported"
        case .resetting: s = "resetting"
        default: s = "unknown"
        }
        onDevice?(["state": s, "connected": connected?.state == .connected])
    }

    // MARK: - CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        emitState(central)
        guard central.state == .poweredOn else { return }
        if pendingScan { startScanLocked(seconds: 15) }
        if let id = pendingConnect { connectLocked(id) }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let isNew = discovered[peripheral.identifier] == nil
        discovered[peripheral.identifier] = peripheral
        if isNew {
            let advName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
            emit(peripheral, rssi: RSSI, state: "discovered", name: peripheral.name ?? advName)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        setConnectedFlag(true)
        peripheral.delegate = self
        peripheral.discoverServices([BleHeartRate.heartRateService])
        emit(peripheral, rssi: nil, state: "connected")
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        if connected?.identifier == peripheral.identifier {
            connected = nil
            setConnectedFlag(false)
        }
        emit(peripheral, rssi: nil, state: "failed")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        emit(peripheral, rssi: nil, state: "disconnected")
        guard connected?.identifier == peripheral.identifier else { return }
        setConnectedFlag(false)
        if userDisconnected {
            connected = nil
        } else {
            // Unexpected drop: try to reconnect (CoreBluetooth connect does not time out).
            central.connect(peripheral, options: nil)
        }
    }

    // MARK: - CBPeripheralDelegate

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else { return }
        for s in peripheral.services ?? [] where s.uuid == BleHeartRate.heartRateService {
            peripheral.discoverCharacteristics([BleHeartRate.heartRateMeasurement], for: s)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil else { return }
        for c in service.characteristics ?? [] where c.uuid == BleHeartRate.heartRateMeasurement {
            peripheral.setNotifyValue(true, for: c)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, characteristic.uuid == BleHeartRate.heartRateMeasurement,
              let data = characteristic.value,
              let parsed = BleHeartRate.parseMeasurement(data) else { return }
        let now = vsNowMs()
        lock.lock()
        lastBpm = parsed.bpm
        lastContact = parsed.contact
        lastSampleMs = now
        for rr in parsed.rrMs { rrLog.append((t: now, rr: rr)) }
        if rrLog.count > 300 { rrLog.removeFirst(rrLog.count - 300) }
        lock.unlock()
    }

    /// Parse a Heart Rate Measurement (0x2A37) value.
    /// flags bit0: uint16 bpm; bits1-2: contact status; bit3: energy expended present;
    /// bit4: RR intervals present (uint16, 1/1024 s).
    static func parseMeasurement(_ data: Data) -> (bpm: Double, contact: Bool, rrMs: [Double])? {
        let bytes = [UInt8](data)
        guard bytes.count >= 2 else { return nil }
        let flags = bytes[0]
        var idx = 1
        let bpm: Int
        if flags & 0x01 != 0 {
            guard bytes.count >= 3 else { return nil }
            bpm = Int(bytes[1]) | (Int(bytes[2]) << 8)
            idx = 3
        } else {
            bpm = Int(bytes[1])
            idx = 2
        }
        // Contact: supported (bit2) and not detected (bit1 == 0) => no contact.
        let contactSupported = flags & 0x04 != 0
        let contactDetected = flags & 0x02 != 0
        let contact = !contactSupported || contactDetected
        if flags & 0x08 != 0 { idx += 2 }
        var rr: [Double] = []
        if flags & 0x10 != 0 {
            while idx + 1 < bytes.count {
                let raw = Int(bytes[idx]) | (Int(bytes[idx + 1]) << 8)
                rr.append(Double(raw) / 1024.0 * 1000.0)
                idx += 2
            }
        }
        guard bpm > 0 else { return nil }
        return (bpm: Double(bpm), contact: contact, rrMs: rr)
    }
}
