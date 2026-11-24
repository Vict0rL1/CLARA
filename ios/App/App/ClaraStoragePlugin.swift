import Foundation
import Capacitor

/// Puente entre la web de Clara y `ClaraFileStore`: los datos se guardan en un archivo de la app, fuera del WebView.
///
/// Solo transporta texto: no interpreta los datos ni calcula nada. Las llamadas llegan por la cola en serie del puente
/// de Capacitor, así que nunca hay dos escrituras a la vez.
///
/// Códigos de rechazo (los lee `src/platform/native/storage.ts`): `invalidName`, `invalidArguments`, `conflict`,
/// `noSpace`, `unavailable`.
@objc(ClaraStoragePlugin)
public class ClaraStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClaraStoragePlugin"
    public let jsName = "ClaraStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private let store = ClaraFileStore.applicationSupport()

    @objc func read(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else {
            call.reject("Falta el nombre", "invalidArguments")
            return
        }
        do {
            if let entry = try store.read(name) {
                call.resolve(["exists": true, "text": entry.text, "revision": entry.revision])
            } else {
                call.resolve(["exists": false])
            }
        } catch {
            fail(call, error)
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let text = call.getString("text"), let revision = call.getInt("revision") else {
            call.reject("Faltan el nombre, el texto o la revisión", "invalidArguments")
            return
        }
        // `expectedRevision` ausente o `null` significa «no había archivo».
        let expected = call.getInt("expectedRevision")
        do {
            try store.write(name, text: text, revision: revision, expectedRevision: expected)
            call.resolve()
        } catch {
            fail(call, error)
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else {
            call.reject("Falta el nombre", "invalidArguments")
            return
        }
        do {
            try store.remove(name)
            call.resolve()
        } catch {
            fail(call, error)
        }
    }

    private func fail(_ call: CAPPluginCall, _ error: Error) {
        guard let storeError = error as? ClaraFileStore.StoreError else {
            call.reject(error.localizedDescription, "unavailable")
            return
        }
        switch storeError {
        case .invalidName:
            call.reject("Nombre no válido", "invalidName")
        case .conflict:
            call.reject("Lo guardado cambió después de leerlo", "conflict")
        case .noSpace:
            call.reject("No queda espacio en el dispositivo", "noSpace")
        case .unavailable(let reason):
            call.reject(reason, "unavailable")
        }
    }
}
