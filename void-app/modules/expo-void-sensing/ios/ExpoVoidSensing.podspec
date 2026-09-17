require 'json'

# Reads the module's package.json (modules/expo-void-sensing/package.json) for
# version/license/author. Falls back to defaults if absent.
package_path = File.join(__dir__, '..', 'package.json')
package =
  if File.exist?(package_path)
    JSON.parse(File.read(package_path))
  else
    {}
  end

Pod::Spec.new do |s|
  s.name           = 'ExpoVoidSensing'
  s.version        = package['version'] || '1.0.0'
  s.summary        = package['description'] || 'On-device sensing/affect bridge for The Void.'
  s.description    = <<-DESC
    The ONLY bridge between the on-device sensing/affect pipeline and JS. Emits solely
    the quantized, DP-noised AffectState; raw sensor buffers never cross the boundary.
    Sensors: CoreMotion, touch kinematics, Vision face landmarks (front camera),
    camera rPPG, rear-camera fingertip PPG, BLE Heart Rate Service. No HealthKit,
    no ARKit/TrueDepth, no microphone.
  DESC
  s.license        = package['license'] || 'UNLICENSED'
  s.author         = package['author'] || 'The Void'
  s.homepage       = package['homepage'] || 'https://thevoid.app'

  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/thevoid/void-app.git', tag: "#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # All sources are self-contained in this directory (no vendored copies).
  s.source_files = '**/*.{h,m,swift}'

  s.frameworks = ['AVFoundation', 'Vision', 'CoreMotion', 'CoreBluetooth', 'Accelerate',
                  'CoreMedia', 'CoreVideo', 'Security', 'UIKit']
  s.weak_frameworks = ['CryptoKit']
end
