// Trust one missing intermediate for one host - the Istanbul city webcams.
//
// livestream.ibb.gov.tr serves only its leaf certificate and leaves out the COMODO
// RSA Organization Validation Secure Server CA that links it to a root Android
// trusts. Desktop browsers fetch the missing intermediate themselves; Android does
// not, so every Turkey cam on the wall failed with 'Trust anchor for certification
// path not found' and the Turkey tiles sat empty. A TLS scan of all 1445 stream
// hosts (2026-10-05) found this to be the only host with that fault.
//
// This ships that intermediate (valid to 2029-02-11, issued by COMODO RSA
// Certification Authority, which IS in the system store) and lets Android use it
// for ibb.gov.tr ONLY. Everything else keeps the system defaults: a network security
// config with no base-config leaves base behaviour exactly as before (release
// builds already disallow cleartext; the manifest sets no usesCleartextTraffic).
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const CERT = 'comodo_rsa_ov_server_ca';
const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config>
    <domain includeSubdomains="true">ibb.gov.tr</domain>
    <trust-anchors>
      <certificates src="system" />
      <certificates src="@raw/${CERT}" />
    </trust-anchors>
  </domain-config>
</network-security-config>
`;

module.exports = function withStreamTrust(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const res = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      fs.mkdirSync(path.join(res, 'xml'), { recursive: true });
      fs.mkdirSync(path.join(res, 'raw'), { recursive: true });
      fs.writeFileSync(path.join(res, 'xml', 'network_security_config.xml'), XML);
      fs.copyFileSync(path.join(__dirname, 'certs', CERT + '.pem'), path.join(res, 'raw', CERT + '.pem'));
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return c;
  });
};
