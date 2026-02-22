require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PylonWidgetBridge'
  s.version        = package['version']
  s.summary        = 'Shared widget summary bridge for Pylon'
  s.description    = 'Writes agent summary data into app group storage for WidgetKit.'
  s.license        = 'MIT'
  s.author         = 'Pylon'
  s.homepage       = 'https://example.invalid/pylon-widget-bridge'
  s.platforms      = { :ios => '14.0' }
  s.swift_version  = '5.4'
  s.source         = { :git => 'https://example.invalid/pylon-widget-bridge.git', :tag => s.version.to_s }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
