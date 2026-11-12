# Añade archivos Swift al target App del proyecto de Xcode de Capacitor (idempotente). Sirve para preparar el proyecto
# desde un entorno sin Xcode: `gem install xcodeproj` y luego
#   ruby scripts/ios-add-swift.rb ios/App/App.xcodeproj Archivo.swift [Otro.swift …]
# Los archivos tienen que estar ya en ios/App/App/. En un Mac basta con arrastrarlos en Xcode.
require 'xcodeproj'
project_path = ARGV.shift
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |t| t.name == 'App' } or abort('no App target')
group = project.main_group.find_subpath('App', false) or abort('no App group')
ARGV.each do |name|
  if group.files.any? { |f| f.path == name }
    puts "already there: #{name}"
    next
  end
  ref = group.new_reference(name)
  target.source_build_phase.add_file_reference(ref, true)
  puts "added: #{name}"
end
project.save
