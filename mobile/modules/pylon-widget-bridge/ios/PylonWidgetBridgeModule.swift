import ExpoModulesCore
import WidgetKit

private let appGroupIdentifier = "group.expoLiveActivity.sharedData"
private let summaryStorageKey = "pylon_widget_agents_v1"
private let summaryUpdatedAtKey = "pylon_widget_agents_updated_at"

public class PylonWidgetBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PylonWidgetBridge")

    Function("setSummaryJson") { (summaryJson: String) -> Bool in
      guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
        return false
      }
      defaults.set(summaryJson, forKey: summaryStorageKey)
      defaults.set(Date().timeIntervalSince1970, forKey: summaryUpdatedAtKey)
      defaults.synchronize()
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
      return true
    }

    Function("clearSummary") { () -> Bool in
      guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
        return false
      }
      defaults.removeObject(forKey: summaryStorageKey)
      defaults.removeObject(forKey: summaryUpdatedAtKey)
      defaults.synchronize()
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
      return true
    }

    Function("getSummaryJson") { () -> String in
      guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
        return "[]"
      }
      return defaults.string(forKey: summaryStorageKey) ?? "[]"
    }
  }
}
