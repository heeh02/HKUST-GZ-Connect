# Android roadmap

Android support will use this repository's Rust protocol and packet modules.
It will not download or embed a third-party EasyConnect engine.

The planned boundary is:

1. compile the Rust transport as Android native libraries;
2. establish `VpnService` routes and pass IP packets across a bounded FFI;
3. keep credentials in Android Keystore-backed storage;
4. reuse the same protocol fixtures, certificate policy, upgrade watcher, and
   restricted compatibility rings as desktop;
5. validate sleep/resume, network handover, reconnect, DNS, and battery impact
   on physical devices before publishing an APK.

There is no APK yet. The desktop Rust engine remains the supported target.
