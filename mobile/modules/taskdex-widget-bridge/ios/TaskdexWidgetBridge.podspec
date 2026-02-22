require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TaskdexWidgetBridge'
  s.version        = package['version']
  s.summary        = 'Shared widget summary bridge for Taskdex'
  s.description    = 'Writes agent summary data into app group storage for WidgetKit.'
  s.license        = 'MIT'
  s.author         = 'Taskdex'
  s.homepage       = 'https://example.invalid/taskdex-widget-bridge'
  s.platforms      = { :ios => '14.0' }
  s.swift_version  = '5.4'
  s.source         = { :git => 'https://example.invalid/taskdex-widget-bridge.git', :tag => s.version.to_s }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
