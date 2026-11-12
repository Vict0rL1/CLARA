import Foundation

/// Almacén de textos con nombre en una carpeta de la app (decisión 156).
///
/// Cada texto es un archivo `<nombre>.clara`. Su primera línea es la revisión (un entero en decimal) y, tras el salto
/// de línea, va el texto tal cual. Dato y revisión viajan en el MISMO archivo para que nunca queden desparejados, y
/// cada escritura sustituye el archivo completo de forma atómica (archivo temporal + renombrar).
///
/// Solo usa Foundation: no sabe nada de Capacitor ni de dinero. El texto es opaco: aquí no se interpreta.
struct ClaraFileStore {
    enum StoreError: Error, Equatable {
        /// El nombre no es `[a-z0-9-]{1,40}`.
        case invalidName
        /// Lo guardado no tiene la revisión que leyó quien escribe. `current` es la que hay (`nil` = no hay archivo).
        case conflict(current: Int?)
        /// No queda espacio en el dispositivo.
        case noSpace
        /// El sistema no dejó leer o escribir.
        case unavailable(String)
    }

    struct Entry: Equatable {
        let text: String
        let revision: Int
    }

    let directory: URL

    /// Carpeta de Clara dentro de Application Support: iOS no la vacía por falta de espacio y entra en la copia del iPhone.
    static func applicationSupport() -> ClaraFileStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return ClaraFileStore(directory: base.appendingPathComponent("Clara", isDirectory: true))
    }

    static func isValidName(_ name: String) -> Bool {
        guard (1...40).contains(name.utf8.count) else { return false }
        return name.utf8.allSatisfy { byte in
            (byte >= 0x61 && byte <= 0x7A) || (byte >= 0x30 && byte <= 0x39) || byte == 0x2D
        }
    }

    func fileURL(_ name: String) throws -> URL {
        guard ClaraFileStore.isValidName(name) else { throw StoreError.invalidName }
        return directory.appendingPathComponent(name + ".clara", isDirectory: false)
    }

    /// Separa la cabecera del texto. Un archivo sin cabecera válida se devuelve entero con revisión 0: nunca se oculta
    /// ni se descarta contenido (quien lo lea decidirá si está dañado).
    static func decode(_ data: Data) -> Entry {
        if let newline = data.firstIndex(of: 0x0A),
           let header = String(data: data[data.startIndex..<newline], encoding: .utf8),
           let revision = Int(header), revision >= 0, String(revision) == header {
            return Entry(text: String(decoding: data[data.index(after: newline)...], as: UTF8.self), revision: revision)
        }
        return Entry(text: String(decoding: data, as: UTF8.self), revision: 0)
    }

    static func encode(text: String, revision: Int) -> Data {
        var data = Data("\(revision)\n".utf8)
        data.append(Data(text.utf8))
        return data
    }

    func read(_ name: String) throws -> Entry? {
        let url = try fileURL(name)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            return ClaraFileStore.decode(try Data(contentsOf: url))
        } catch {
            throw StoreError.unavailable(error.localizedDescription)
        }
    }

    /// Revisión de lo guardado sin leer el archivo entero (`nil` = no hay archivo).
    func currentRevision(_ name: String) throws -> Int? {
        let url = try fileURL(name)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            // Una revisión cabe de sobra en 32 bytes; si no hay salto de línea ahí, el archivo no tiene cabecera.
            let head = try handle.read(upToCount: 32) ?? Data()
            guard head.contains(0x0A) else { return 0 }
            return ClaraFileStore.decode(head).revision
        } catch {
            throw StoreError.unavailable(error.localizedDescription)
        }
    }

    /// Sustituye el texto de forma atómica si lo guardado tiene `expectedRevision` (`nil` = «no había archivo»).
    /// Antes de sustituir deja la versión anterior en `<nombre>.clara.prev` (en APFS es un clon: no ocupa el doble).
    func write(_ name: String, text: String, revision: Int, expectedRevision: Int?) throws {
        let url = try fileURL(name)
        let current = try currentRevision(name)
        guard current == expectedRevision else { throw StoreError.conflict(current: current) }
        let manager = FileManager.default
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
            if current != nil {
                let previous = url.appendingPathExtension("prev")
                try? manager.removeItem(at: previous)
                try? manager.copyItem(at: url, to: previous)
            }
            try ClaraFileStore.encode(text: text, revision: revision).write(to: url, options: [.atomic])
        } catch let error as NSError {
            if error.domain == NSCocoaErrorDomain && error.code == NSFileWriteOutOfSpaceError { throw StoreError.noSpace }
            if error.domain == NSPOSIXErrorDomain && error.code == Int(ENOSPC) { throw StoreError.noSpace }
            throw StoreError.unavailable(error.localizedDescription)
        }
    }

    /// Quita el texto y su versión anterior. Que no exista no es un error.
    func remove(_ name: String) throws {
        let url = try fileURL(name)
        let manager = FileManager.default
        for target in [url, url.appendingPathExtension("prev")] where manager.fileExists(atPath: target.path) {
            do {
                try manager.removeItem(at: target)
            } catch {
                throw StoreError.unavailable(error.localizedDescription)
            }
        }
    }
}
