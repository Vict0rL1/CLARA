import XCTest
@testable import ClaraNativeCore

/// El archivo propio de la app (Fase 1, decisión 156): revisión en la primera línea, escritura atómica, conflicto.
final class ClaraFileStoreTests: XCTestCase {
    private var store: ClaraFileStore!

    override func setUpWithError() throws {
        store = ClaraFileStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("clara-store-\(UUID().uuidString)", isDirectory: true))
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: store.directory)
    }

    func testNamesAreRestricted() {
        XCTAssertTrue(ClaraFileStore.isValidName("data"))
        XCTAssertTrue(ClaraFileStore.isValidName("local-backup-1"))
        XCTAssertFalse(ClaraFileStore.isValidName(""))
        XCTAssertFalse(ClaraFileStore.isValidName("../data"))
        XCTAssertFalse(ClaraFileStore.isValidName("Data"))
        XCTAssertThrowsError(try store.read("../x")) { XCTAssertEqual($0 as? ClaraFileStore.StoreError, .invalidName) }
    }

    func testWriteReadAndRevisionTravelTogether() throws {
        XCTAssertNil(try store.read("data"))
        try store.write("data", text: "{\"a\":1}\nsegunda línea", revision: 1, expectedRevision: nil)
        XCTAssertEqual(try store.read("data"), ClaraFileStore.Entry(text: "{\"a\":1}\nsegunda línea", revision: 1))
        XCTAssertEqual(try store.currentRevision("data"), 1)
        try store.write("data", text: "dos", revision: 2, expectedRevision: 1)
        XCTAssertEqual(try store.read("data")?.text, "dos")
        let previous = store.directory.appendingPathComponent("data.clara.prev")
        XCTAssertEqual(ClaraFileStore.decode(try Data(contentsOf: previous)).revision, 1, "la versión anterior queda al lado")
    }

    func testConflictWhenSomeoneElseWroteFirst() throws {
        try store.write("data", text: "uno", revision: 1, expectedRevision: nil)
        XCTAssertThrowsError(try store.write("data", text: "otro", revision: 2, expectedRevision: nil)) {
            XCTAssertEqual($0 as? ClaraFileStore.StoreError, .conflict(current: 1))
        }
        XCTAssertEqual(try store.read("data")?.text, "uno")
    }

    func testAFileWithoutHeaderIsReturnedWholeNeverHidden() {
        XCTAssertEqual(ClaraFileStore.decode(Data("sin cabecera".utf8)), ClaraFileStore.Entry(text: "sin cabecera", revision: 0))
        XCTAssertEqual(ClaraFileStore.decode(Data("007\nx".utf8)), ClaraFileStore.Entry(text: "007\nx", revision: 0))
    }

    func testRemoveTakesThePreviousVersionToo() throws {
        try store.write("data", text: "uno", revision: 1, expectedRevision: nil)
        try store.write("data", text: "dos", revision: 2, expectedRevision: 1)
        try store.remove("data")
        XCTAssertNil(try store.read("data"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.directory.appendingPathComponent("data.clara.prev").path))
        XCTAssertNoThrow(try store.remove("data"))
    }
}
