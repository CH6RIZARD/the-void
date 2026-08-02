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
    The ONLY bridge between the native on-device sensing/affect pipeline
    (void-rank VoidSensing) and JS. Emits solely the quantized, DP-noised
    AffectState; raw physiological buffers never cross the boundary (invariant #1).
  DESC
  s.license        = package['license'] || 'UNLICENSED'
  s.author         = package['author'] || 'The Void'
  s.homepage       = package['homepage'] || 'https://thevoid.app'

  # Expo 51 template default; VoidSensing's SwiftPM manifest declares iOS 26 as a
  # project convention, but its sources compile far lower. EAS/Xcode use the app's
  # own deployment target, so we do not raise the app floor here.
  s.platforms      = { :ios => '13.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/thevoid/void-app.git', tag: "#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # --- VoidSensing linkage -------------------------------------------------
  # The already-built native sensing package lives OUTSIDE this pod at:
  #   <repo-root>/void-rank/ios/VoidSensing
  # relative to this podspec (modules/expo-void-sensing/ios):
  #   ../../../../../void-rank/ios/VoidSensing/Sources/VoidSensing
  #   ( ios → expo-void-sensing → modules → void-app → "The Void" → all-projects )
  #
  # CocoaPods requires source files to live inside the pod root, so at `pod install`
  # we VENDOR (copy) the VoidSensing Swift sources into ./vendor/VoidSensing and
  # compile them into THIS target. Compiling them into the same module means the
  # adapter sees their public types directly — no separate `import VoidSensing`.
  #
  # If the relative path differs in your checkout, either fix VOIDSENSING_SRC below
  # or copy the sources into ios/vendor/VoidSensing yourself before `pod install`.
  s.prepare_command = <<-CMD
    set -e
    VOIDSENSING_SRC="../../../../../void-rank/ios/VoidSensing/Sources/VoidSensing"
    rm -rf vendor/VoidSensing
    mkdir -p vendor/VoidSensing
    if [ -d "$VOIDSENSING_SRC" ]; then
      cp -R "$VOIDSENSING_SRC/." vendor/VoidSensing/
    else
      echo "error: [ExpoVoidSensing] VoidSensing sources not found at $VOIDSENSING_SRC." >&2
      echo "       Ensure the void-rank checkout is a sibling of 'The Void', or copy" >&2
      echo "       void-rank/ios/VoidSensing/Sources/VoidSensing into ios/vendor/VoidSensing." >&2
      exit 1
    fi
  CMD

  # Adapter sources (this dir) + the vendored VoidSensing sources.
  s.source_files = [
    '*.{h,m,mm,swift}',
    'vendor/VoidSensing/**/*.swift'
  ]

  # Frameworks the vendored pipeline links against; each VoidSensing file already
  # wraps its use in `#if canImport(...)`, so weak linkage is safe on any device.
  s.weak_frameworks = ['CoreMotion', 'AVFoundation', 'CoreImage', 'ARKit', 'CoreML', 'Security']
end
