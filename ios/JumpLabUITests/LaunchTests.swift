import XCTest
final class LaunchTests: XCTestCase {
  func testColdLaunch() {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["JumpLab"].waitForExistence(timeout: 20))
    XCTAssertTrue(app.buttons["Log in"].waitForExistence(timeout: 10))
    let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.lifetime = .keepAlways
    add(attachment)
  }
  func testLargeTextDarkLaunch() {
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL", "-AppleInterfaceStyle", "Dark"]
    app.launch()
    XCTAssertTrue(app.staticTexts["JumpLab"].waitForExistence(timeout: 20))
    app.swipeUp()
    XCTAssertTrue(app.buttons["Recover password"].waitForExistence(timeout: 10))
    let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testSystemPickerCanCancel() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let email = environment["JUMPLAB_UI_TEST_EMAIL"],
      let password = environment["JUMPLAB_UI_TEST_PASSWORD"], !email.isEmpty, !password.isEmpty else {
      throw XCTSkip("A disposable confirmed account is required to exercise the iOS Photos picker.")
    }
    let app = XCUIApplication()
    app.launch()
    let emailField = app.textFields["Email"]
    XCTAssertTrue(emailField.waitForExistence(timeout: 20))
    emailField.tap()
    emailField.typeText(email)
    let passwordField = app.secureTextFields["Password (at least 12 characters)"]
    passwordField.tap()
    passwordField.typeText(password)
    app.buttons["Log in"].tap()

    let analyze = app.buttons["Analyze"]
    XCTAssertTrue(analyze.waitForExistence(timeout: 20))
    addTeardownBlock {
      let settings = app.buttons["Settings"]
      if settings.isHittable {
        settings.tap()
        let signOut = app.buttons["Sign out"]
        if signOut.isHittable {
          signOut.tap()
          app.alerts.buttons["Sign out and erase local data"].tap()
        }
      }
    }
    analyze.tap()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "fixed camera")).firstMatch.exists)
    let choose = app.buttons["choose-video"]
    if !choose.isHittable { app.swipeUp() }
    choose.tap()
    let cancel = app.buttons["Cancel"]
    XCTAssertTrue(cancel.waitForExistence(timeout: 10))
    cancel.tap()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Import cancelled")).firstMatch.waitForExistence(timeout: 10))
  }
}
