import UIKit

@main final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application:UIApplication,configurationForConnecting connectingSceneSession:UISceneSession,options:UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c=UISceneConfiguration(name:"Default",sessionRole:connectingSceneSession.role); c.delegateClass=ProbeSceneDelegate.self; return c
    }
}
final class ProbeSceneDelegate:NSObject,UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene:UIScene,willConnectTo session:UISceneSession,options connectionOptions:UIScene.ConnectionOptions) {
        guard let scene=scene as? UIWindowScene else { return }
        let window=UIWindow(windowScene:scene); window.rootViewController=ProbeViewController(); window.makeKeyAndVisible(); self.window=window
    }
    func sceneDidEnterBackground(_ scene:UIScene) { (window?.rootViewController as? ProbeViewController)?.suspend() }
    func sceneWillResignActive(_ scene:UIScene) { (window?.rootViewController as? ProbeViewController)?.resignActive() }
    func sceneDidDisconnect(_ scene:UIScene) { (window?.rootViewController as? ProbeViewController)?.suspend() }
}
