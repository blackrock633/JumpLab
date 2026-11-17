Pod::Spec.new do |s|
  s.name = 'JumpAnalysis'
  s.version = '0.1.0'
  s.summary = 'Local AVFoundation and Vision jump feasibility pipeline'
  s.description = 'Incremental native decoding. No media network path.'
  s.author = 'JumpLab'
  s.homepage = 'https://example.invalid/jumplab'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
  s.frameworks = 'AVFoundation', 'Vision', 'PhotosUI', 'UniformTypeIdentifiers'
end
