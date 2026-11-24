// swift-tools-version:5.9
// Pruebas del Swift de Clara que no depende de iOS ni de Capacitor: la cola de capturas y el almacén de archivos.
// En el Mac: `cd ios/ClaraNativeTests && swift test` (no hace falta abrir Xcode ni tocar el proyecto de la app).
// Las fuentes son enlaces a los archivos de la app (`ios/App/App/`): se prueba exactamente lo que compila la app.
import PackageDescription

let package = Package(
    name: "ClaraNativeTests",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "ClaraNativeCore", path: "Sources/ClaraNativeCore"),
        .testTarget(name: "ClaraNativeCoreTests", dependencies: ["ClaraNativeCore"], path: "Tests/ClaraNativeCoreTests"),
    ]
)
