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
}
