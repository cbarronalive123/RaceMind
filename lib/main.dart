import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ─── Models ──────────────────────────────────────────────────────────

class LiveFrame {
  final int lap;
  final int totalLaps;
  final double speedKmh;
  final int gear;
  final int rpm;
  final double throttlePct;
  final double brakePct;
  final double fuelRemainingKg;
  final double tyreWearPct;
  final String tyreCompound;
  final double ersSocPct;
  final double airTempC;
  final double trackTempC;
  final double lat;
  final double lon;
  final String status;
  final bool driving;

  LiveFrame({
    required this.lap, required this.totalLaps, required this.speedKmh,
    required this.gear, required this.rpm, required this.throttlePct,
    required this.brakePct, required this.fuelRemainingKg,
    required this.tyreWearPct, required this.tyreCompound,
    required this.ersSocPct, required this.airTempC, required this.trackTempC,
    required this.lat, required this.lon, required this.status, required this.driving,
  });
}

class Indicator {
  final String kind;
  final String message;
  final String urgency;
  final DateTime received;
  Indicator({required this.kind, required this.message, required this.urgency, required this.received});
}

class GpsPoint {
  final double lat, lon, speed;
  final DateTime ts;
  GpsPoint({required this.lat, required this.lon, required this.speed, required this.ts});
}

class ControlState {
  final bool driving;
  final bool running;
  final double speedMultiplier;
  ControlState({required this.driving, required this.running, required this.speedMultiplier});
}

// ─── Beep Service ────────────────────────────────────────────────────

class BeepService {
  static final BeepService _instance = BeepService._();
  factory BeepService() => _instance;
  BeepService._();
  bool _enabled = true;
  bool get enabled => _enabled;
  set enabled(bool v) => _enabled = v;

  Future<void> beep({bool urgent = false}) async {
    if (!_enabled) return;
    SystemSound.play(SystemSoundType.alert);
    if (urgent) {
      await Future.delayed(const Duration(milliseconds: 50));
      SystemSound.play(SystemSoundType.alert);
    }
  }

  Future<void> doubleBeep() async {
    await beep();
    await Future.delayed(const Duration(milliseconds: 150));
    await beep();
  }

  Future<void> urgentBeep() async {
    for (int i = 0; i < 3; i++) {
      await beep(urgent: true);
      await Future.delayed(const Duration(milliseconds: 100));
    }
  }
}

// ─── Race Server Connection ──────────────────────────────────────────

class RaceConnection extends ChangeNotifier {
  WebSocketChannel? _channel;
  LiveFrame? _frame;
  ControlState _control = ControlState(driving: false, running: true, speedMultiplier: 4);
  final List<Indicator> _indicators = [];
  bool _connected = false;
  final FlutterTts _tts = FlutterTts();
  final BeepService _beep = BeepService();
  Timer? _reconnectTimer;

  // Default to production server. Emulator uses 10.0.2.2 to reach host.
  // Production: ws://45.137.194.227:8083/ws
  // Local dev:  ws://10.0.2.2:4000
  String _serverUrl = 'ws://45.137.194.227:8083/ws';

  LiveFrame? get frame => _frame;
  ControlState get control => _control;
  List<Indicator> get indicators => List.unmodifiable(_indicators);

  void clearIndicators() {
    _indicators.clear();
    notifyListeners();
  }
  bool get connected => _connected;
  String get serverUrl => _serverUrl;
  bool get beepsEnabled => _beep.enabled;

  Future<void> loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    _serverUrl = prefs.getString('server_url') ?? _serverUrl;
    _beep.enabled = prefs.getBool('beeps_enabled') ?? true;
  }

  Future<void> setServerUrl(String url) async {
    _serverUrl = url;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_url', url);
    await connect();
  }

  Future<void> setBeepsEnabled(bool enabled) async {
    _beep.enabled = enabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('beeps_enabled', enabled);
    notifyListeners();
  }

  Future<void> connect() async {
    _reconnectTimer?.cancel();
    await disconnect();
    try {
      _channel = WebSocketChannel.connect(Uri.parse(_serverUrl));
      _connected = true;
      notifyListeners();
      _channel!.stream.listen(
        (data) => _handleMessage(data),
        onError: (e) => _scheduleReconnect(),
        onDone: () => _scheduleReconnect(),
      );
    } catch (e) {
      _connected = false;
      notifyListeners();
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _connected = false;
    notifyListeners();
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 3), connect);
  }

  void _handleMessage(String raw) {
    try {
      final msg = jsonDecode(raw) as Map<String, dynamic>;
      switch (msg['type']) {
        case 'snapshot':
          _applySnapshot(msg);
          break;
        case 'frame':
          _applyFrame(msg);
          break;
        case 'control':
          _control = ControlState(
            driving: msg['control']['driving'] ?? false,
            running: msg['control']['running'] ?? true,
            speedMultiplier: (msg['control']['speedMultiplier'] ?? 4).toDouble(),
          );
          notifyListeners();
          break;
        case 'indicator':
          _handleIndicator(msg['indicator']);
          break;
      }
    } catch (e) {
      debugPrint('parse error: $e');
    }
  }

  void _applySnapshot(Map<String, dynamic> msg) {
    final frame = msg['frame'] as Map<String, dynamic>;
    final live = msg['live'] as Map<String, dynamic>;
    final meta = msg['meta'] as Map<String, dynamic>;
    final control = msg['control'] as Map<String, dynamic>;
    _frame = _parseFrame(frame, live, meta, control);
    _control = ControlState(
      driving: control['driving'] ?? false,
      running: control['running'] ?? true,
      speedMultiplier: (control['speedMultiplier'] ?? 4).toDouble(),
    );
    notifyListeners();
  }

  void _applyFrame(Map<String, dynamic> msg) {
    final frame = msg['frame'] as Map<String, dynamic>;
    final live = msg['live'] as Map<String, dynamic>;
    if (_frame == null) return;
    _frame = _parseFrame(frame, live, null, null);
    notifyListeners();
  }

  LiveFrame _parseFrame(Map<String, dynamic> f, Map<String, dynamic> live,
      Map<String, dynamic>? meta, Map<String, dynamic>? control) {
    return LiveFrame(
      lap: (f['lap'] ?? 1).toInt(),
      totalLaps: meta?['total_laps'] ?? _frame?.totalLaps ?? 57,
      speedKmh: (f['speed_kmh'] ?? 0).toDouble(),
      gear: (f['gear'] ?? 1).toInt(),
      rpm: (f['rpm'] ?? 0).toInt(),
      throttlePct: (f['throttle_pct'] ?? 0).toDouble(),
      brakePct: (f['brake_pct'] ?? 0).toDouble(),
      fuelRemainingKg: (f['fuel']?['remaining_kg'] ?? 0).toDouble(),
      tyreWearPct: (f['tyres']?['wear_pct'] ?? 0).toDouble(),
      tyreCompound: f['tyres']?['compound'] ?? 'medium',
      ersSocPct: (f['ers']?['soc_pct'] ?? 0).toDouble(),
      airTempC: (f['weather']?['air_temp_c'] ?? 0).toDouble(),
      trackTempC: (f['weather']?['track_temp_c'] ?? 0).toDouble(),
      lat: (f['lat'] ?? 0).toDouble(),
      lon: (f['lon'] ?? 0).toDouble(),
      status: live['status'] ?? 'live',
      driving: control?['driving'] ?? _frame?.driving ?? false,
    );
  }

  void _handleIndicator(Map<String, dynamic> ind) {
    final indicator = Indicator(
      kind: ind['kind'] ?? 'info',
      message: ind['message'] ?? '',
      urgency: ind['urgency'] ?? 'info',
      received: DateTime.now(),
    );
    _indicators.insert(0, indicator);
    if (_indicators.length > 20) _indicators.removeLast();
    notifyListeners();

    switch (indicator.urgency) {
      case 'critical':
      case 'high':
        _beep.urgentBeep();
        break;
      case 'medium':
      case 'warn':
        _beep.doubleBeep();
        break;
      default:
        _beep.beep();
    }

    if (indicator.kind == 'alert' || indicator.kind == 'agent') {
      _tts.speak(indicator.message);
    }
  }

  void sendStartDriving() => _channel?.sink.add(jsonEncode({'type': 'startDriving'}));
  void sendStopDriving() => _channel?.sink.add(jsonEncode({'type': 'stopDriving'}));
  void sendReset() => _channel?.sink.add(jsonEncode({'type': 'reset'}));

  void sendTracePoint(double lat, double lon, double speed) {
    _channel?.sink.add(jsonEncode({
      'type': 'trace_point',
      'lat': lat,
      'lon': lon,
      'ts': DateTime.now().millisecondsSinceEpoch / 1000.0,
      'speed': speed,
    }));
  }

  Future<void> disconnect() async {
    await _channel?.sink.close();
    _channel = null;
    _connected = false;
    notifyListeners();
  }
}

// ─── App ──────────────────────────────────────────────────────────────

void main() => runApp(const RaceMindApp());

class RaceMindApp extends StatelessWidget {
  const RaceMindApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RaceMind',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        primaryColor: const Color(0xFFE53935),
        scaffoldBackgroundColor: const Color(0xFF0A0E17),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFFE53935),
          secondary: Color(0xFF00E676),
          surface: Color(0xFF141922),
        ),
      ),
      home: const SplashScreen(),
    );
  }
}

// ─── Splash Screen ────────────────────────────────────────────────────

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});
  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final race = RaceConnection();
    await race.loadSettings();
    await race.connect();
    await Future.delayed(const Duration(seconds: 2));
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => MainScreen(race: race)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0E17),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 120,
              height: 120,
              decoration: BoxDecoration(
                color: const Color(0xFFE53935),
                borderRadius: BorderRadius.circular(24),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFE53935).withOpacity(0.4),
                    blurRadius: 30,
                    spreadRadius: 5,
                  ),
                ],
              ),
              child: const Icon(Icons.sports_motorsports, size: 72, color: Colors.white),
            ),
            const SizedBox(height: 24),
            const Text('RACEMIND', style: TextStyle(fontSize: 36, fontWeight: FontWeight.bold, color: Colors.white, letterSpacing: 4)),
            const SizedBox(height: 8),
            Text('Pit Lane Telemetry', style: TextStyle(fontSize: 14, color: Colors.white.withOpacity(0.5))),
            const SizedBox(height: 40),
            const SizedBox(width: 32, height: 32, child: CircularProgressIndicator(strokeWidth: 3, valueColor: AlwaysStoppedAnimation(Color(0xFFE53935)))),
          ],
        ),
      ),
    );
  }
}

// ─── Main Screen with Tabs ────────────────────────────────────────────

class MainScreen extends StatefulWidget {
  final RaceConnection race;
  const MainScreen({super.key, required this.race});
  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  int _tabIndex = 0;

  @override
  void dispose() {
    widget.race.disconnect();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.race,
      builder: (context, _) {
        return Scaffold(
          body: IndexedStack(
            index: _tabIndex,
            children: [
              LiveRaceScreen(race: widget.race),
              TrackTraceScreen(race: widget.race),
              SettingsScreen(race: widget.race),
            ],
          ),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _tabIndex,
            onDestinationSelected: (i) => setState(() => _tabIndex = i),
            backgroundColor: const Color(0xFF141922),
            indicatorColor: const Color(0xFFE53935),
            destinations: const [
              NavigationDestination(icon: Icon(Icons.speed), label: 'Live'),
              NavigationDestination(icon: Icon(Icons.map), label: 'Trace'),
              NavigationDestination(icon: Icon(Icons.settings), label: 'Settings'),
            ],
          ),
        );
      },
    );
  }
}

// ─── Live Race Screen (scrollable, weather + race controls here) ─────

class LiveRaceScreen extends StatelessWidget {
  final RaceConnection race;
  const LiveRaceScreen({super.key, required this.race});

  @override
  Widget build(BuildContext context) {
    final frame = race.frame;
    final connected = race.connected;
    final driving = race.control.driving;

    return Scaffold(
      appBar: AppBar(
        title: const Text('RaceMind Live', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF141922),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(child: Row(children: [
              Icon(Icons.circle, size: 8, color: connected ? Colors.green : Colors.red),
              const SizedBox(width: 6),
              Text(connected ? 'Connected' : 'Offline', style: const TextStyle(fontSize: 11)),
            ])),
          ),
        ],
      ),
      body: SafeArea(
        child: frame == null
          ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const CircularProgressIndicator(color: Color(0xFFE53935)),
              const SizedBox(height: 16),
              Text(connected ? 'Waiting for data...' : 'Connecting to server...',
                  style: TextStyle(color: Colors.white.withOpacity(0.5))),
            ]))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                // Status bar
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: driving ? const Color(0xFF00E676).withOpacity(0.1) : const Color(0xFFFF9800).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(children: [
                    Icon(Icons.circle, size: 10, color: driving ? Colors.green : Colors.orange),
                    const SizedBox(width: 8),
                    Text(driving ? 'LIVE' : 'STATIONARY',
                        style: TextStyle(color: driving ? Colors.green : Colors.orange, fontWeight: FontWeight.bold, fontSize: 13)),
                    const Spacer(),
                    Text('Lap ${frame.lap} / ${frame.totalLaps}',
                        style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 13)),
                  ]),
                ),
                const SizedBox(height: 16),

                // Speed gauge
                Container(
                  decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
                  padding: const EdgeInsets.all(20),
                  child: Column(children: [
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${frame.speedKmh.toStringAsFixed(0)}', style: const TextStyle(fontSize: 64, fontWeight: FontWeight.bold, color: Colors.white)),
                        const Text('km/h', style: TextStyle(fontSize: 14, color: Colors.white54)),
                        const SizedBox(height: 8),
                        LinearProgressIndicator(
                          value: (frame.speedKmh / 370).clamp(0.0, 1.0),
                          backgroundColor: Colors.grey[800],
                          valueColor: AlwaysStoppedAnimation(frame.speedKmh > 250 ? const Color(0xFFE53935) : frame.speedKmh > 150 ? Colors.orange : Colors.green),
                          minHeight: 6,
                        ),
                      ]),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(color: Colors.black.withOpacity(0.3), borderRadius: BorderRadius.circular(8)),
                        child: Text('[${frame.gear}]', style: const TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: Color(0xFFE53935))),
                      ),
                    ]),
                    const SizedBox(height: 16),
                    Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
                      _StatChip(label: 'RPM', value: '${frame.rpm}'),
                      _StatChip(label: 'Throttle', value: '${frame.throttlePct.toStringAsFixed(0)}%'),
                      _StatChip(label: 'Brake', value: '${frame.brakePct.toStringAsFixed(0)}%'),
                    ]),
                  ]),
                ),
                const SizedBox(height: 12),

                // Gauges
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
                  child: Column(children: [
                    _GaugeRow(label: 'Fuel', value: frame.fuelRemainingKg, max: 15, unit: 'kg'),
                    _GaugeRow(label: 'Tyre wear', value: frame.tyreWearPct, max: 100, unit: '%'),
                    _GaugeRow(label: 'ERS', value: frame.ersSocPct, max: 100, unit: '%'),
                  ]),
                ),
                const SizedBox(height: 12),

                // Weather — Live tab only
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
                  child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
                    _StatChip(label: 'Air', value: '${frame.airTempC.toStringAsFixed(0)}°C'),
                    _StatChip(label: 'Track', value: '${frame.trackTempC.toStringAsFixed(0)}°C'),
                    _StatChip(label: 'Tyre', value: frame.tyreCompound.toUpperCase()),
                  ]),
                ),
                const SizedBox(height: 12),

                // GPS coords
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFF2A3040))),
                  child: Row(children: [
                    const Icon(Icons.gps_fixed, size: 16, color: Colors.green),
                    const SizedBox(width: 8),
                    Text('Lat: ${frame.lat.toStringAsFixed(6)}  Lon: ${frame.lon.toStringAsFixed(6)}',
                        style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 12)),
                  ]),
                ),
                const SizedBox(height: 16),

                // Alerts — inline on Live tab
                _AlertsSection(race: race),

                // Race controls — Live tab only
                Row(children: [
                  Expanded(child: FilledButton.icon(
                    onPressed: driving ? null : race.sendStartDriving,
                    icon: const Icon(Icons.play_arrow), label: const Text('START'),
                    style: FilledButton.styleFrom(backgroundColor: const Color(0xFF00E676), foregroundColor: Colors.black),
                  )),
                  const SizedBox(width: 8),
                  Expanded(child: FilledButton.icon(
                    onPressed: driving ? race.sendStopDriving : null,
                    icon: const Icon(Icons.stop), label: const Text('STOP'),
                    style: FilledButton.styleFrom(backgroundColor: Colors.orange),
                  )),
                  const SizedBox(width: 8),
                  Expanded(child: FilledButton.icon(
                    onPressed: race.sendReset,
                    icon: const Icon(Icons.refresh), label: const Text('RESET'),
                    style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE53935)),
                  )),
                ]),
              ]),
            ),
      ),
    );
  }
}

// ─── Alerts Section (inline on Live tab) ─────────────────────────────

class _AlertsSection extends StatelessWidget {
  final RaceConnection race;
  const _AlertsSection({required this.race});

  @override
  Widget build(BuildContext context) {
    final indicators = race.indicators;
    return Container(
      decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.notifications_active, size: 18, color: indicators.isNotEmpty ? const Color(0xFFE53935) : Colors.white.withOpacity(0.3)),
          const SizedBox(width: 8),
          Text('Alerts', style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 13, fontWeight: FontWeight.w600)),
          const Spacer(),
          if (indicators.isNotEmpty)
            Text('${indicators.length}', style: TextStyle(color: const Color(0xFFE53935), fontSize: 12, fontWeight: FontWeight.bold)),
          if (indicators.isNotEmpty) ...[
            const SizedBox(width: 8),
            GestureDetector(
              onTap: race.clearIndicators,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(border: Border.all(color: Colors.white.withOpacity(0.2)), borderRadius: BorderRadius.circular(4)),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.clear_all, size: 14, color: Colors.white.withOpacity(0.5)),
                  const SizedBox(width: 4),
                  Text('Clear', style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 11)),
                ]),
              ),
            ),
          ],
        ]),
        const SizedBox(height: 8),
        if (indicators.isEmpty)
          Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Center(child: Text('No alerts', style: TextStyle(color: Colors.white.withOpacity(0.2), fontSize: 12))))
        else
          Column(children: indicators.take(5).map((ind) {
            final color = _urgencyColor(ind.urgency);
            return Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: color.withOpacity(0.08), borderRadius: BorderRadius.circular(6), border: Border.all(color: color.withOpacity(0.2))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Icon(Icons.warning_amber_rounded, color: color, size: 14),
                  const SizedBox(width: 6),
                  Text(ind.kind.toUpperCase(), style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 10)),
                  const Spacer(),
                  Text('${ind.received.hour}:${ind.received.minute.toString().padLeft(2, '0')}:${ind.received.second.toString().padLeft(2, '0')}',
                      style: TextStyle(color: Colors.white.withOpacity(0.3), fontSize: 10)),
                ]),
                const SizedBox(height: 4),
                Text(ind.message, style: const TextStyle(color: Colors.white, fontSize: 13), maxLines: 2, overflow: TextOverflow.ellipsis),
              ]),
            );
          }).toList()),
      ]),
    );
  }

  Color _urgencyColor(String urgency) {
    switch (urgency) {
      case 'critical': return const Color(0xFFFF5252);
      case 'high': return Colors.orange;
      case 'medium': case 'warn': return Colors.yellow;
      default: return Colors.blue;
    }
  }
}

// ─── Track & Trace Screen (trace controls only, no weather) ──────────

class TrackTraceScreen extends StatefulWidget {
  final RaceConnection race;
  const TrackTraceScreen({super.key, required this.race});
  @override
  State<TrackTraceScreen> createState() => _TrackTraceScreenState();
}

class _TrackTraceScreenState extends State<TrackTraceScreen> {
  bool _tracing = false;
  final List<GpsPoint> _points = [];
  StreamSubscription<Position>? _gpsSub;
  double _currentLat = 0, _currentLon = 0, _currentSpeed = 0, _distance = 0;
  int _seconds = 0;
  Timer? _timer;

  Future<void> _startTracing() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return;

    setState(() { _tracing = true; _points.clear(); _distance = 0; _seconds = 0; });
    _timer = Timer.periodic(const Duration(seconds: 1), (_) { setState(() => _seconds++); });
    _gpsSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 0),
    ).listen((pos) {
      final point = GpsPoint(lat: pos.latitude, lon: pos.longitude, speed: (pos.speed > 0 ? pos.speed * 3.6 : 0), ts: pos.timestamp);
      setState(() {
        _currentLat = pos.latitude; _currentLon = pos.longitude; _currentSpeed = point.speed; _points.add(point);
        if (_points.length > 1) {
          _distance += Geolocator.distanceBetween(_points[_points.length - 2].lat, _points[_points.length - 2].lon, pos.latitude, pos.longitude);
        }
      });
      widget.race.sendTracePoint(pos.latitude, pos.longitude, point.speed);
    });
  }

  Future<void> _stopTracing() async {
    await _gpsSub?.cancel();
    _timer?.cancel();
    setState(() => _tracing = false);
  }

  @override
  void dispose() { _gpsSub?.cancel(); _timer?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Track & Trace', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)), backgroundColor: const Color(0xFF141922)),
      body: SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // GPS stats — Trace tab only
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
          child: Column(children: [
            Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
              _GpsStat(label: 'Latitude', value: _currentLat.toStringAsFixed(6)),
              _GpsStat(label: 'Longitude', value: _currentLon.toStringAsFixed(6)),
            ]),
            const SizedBox(height: 12),
            Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
              _GpsStat(label: 'Speed', value: '${_currentSpeed.toStringAsFixed(1)} km/h'),
              _GpsStat(label: 'Points', value: '${_points.length}'),
              _GpsStat(label: 'Distance', value: '${(_distance / 1000).toStringAsFixed(3)} km'),
              _GpsStat(label: 'Time', value: '${_seconds ~/ 60}:${(_seconds % 60).toString().padLeft(2, '0')}'),
            ]),
          ]),
        ),
        const SizedBox(height: 16),

        // Map canvas
        Container(
          height: 300,
          decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: CustomPaint(
              painter: _points.length >= 2 ? TracePainter(_points) : null,
              child: _points.length < 2
                ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(Icons.map, size: 48, color: Colors.white.withOpacity(0.2)),
                    const SizedBox(height: 8),
                    Text('Press START to trace a track', style: TextStyle(color: Colors.white.withOpacity(0.3))),
                  ]))
                : null,
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Trace controls — Trace tab only
        Row(children: [
          Expanded(child: FilledButton.icon(
            onPressed: _tracing ? null : _startTracing,
            icon: const Icon(Icons.fiber_manual_record), label: const Text('START TRACING'),
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFF00E676), foregroundColor: Colors.black),
          )),
          const SizedBox(width: 8),
          Expanded(child: FilledButton.icon(
            onPressed: _tracing ? _stopTracing : null,
            icon: const Icon(Icons.stop), label: const Text('STOP'),
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE53935)),
          )),
        ]),
        if (!_tracing && _points.isNotEmpty) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () { setState(() { _points.clear(); _distance = 0; _seconds = 0; }); },
            icon: const Icon(Icons.clear), label: const Text('CLEAR TRACE'),
          ),
        ],
      ]))),
    );
  }
}

// ─── Settings Screen ──────────────────────────────────────────────────

class SettingsScreen extends StatefulWidget {
  final RaceConnection race;
  const SettingsScreen({super.key, required this.race});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late TextEditingController _urlController;
  bool _beepsEnabled = true;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: widget.race.serverUrl);
    _beepsEnabled = widget.race.beepsEnabled;
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF141922),
      ),
      body: SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // Server connection
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Server Connection', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            const Text('WebSocket URL', style: TextStyle(color: Colors.white54, fontSize: 12)),
            const SizedBox(height: 4),
            TextField(
              controller: _urlController,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: InputDecoration(
                hintText: 'ws://host:port/ws',
                hintStyle: TextStyle(color: Colors.white.withOpacity(0.3)),
                filled: true,
                fillColor: const Color(0xFF0A0E17),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Icon(Icons.circle, size: 8, color: widget.race.connected ? Colors.green : Colors.red),
              const SizedBox(width: 6),
              Text(widget.race.connected ? 'Connected' : 'Disconnected', style: TextStyle(color: widget.race.connected ? Colors.green : Colors.red, fontSize: 12)),
            ]),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: FilledButton(
                onPressed: () => widget.race.setServerUrl(_urlController.text.trim()),
                child: const Text('CONNECT'),
              )),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: () {
                  _urlController.text = 'ws://45.137.194.227:8083/ws';
                },
                child: const Text('Production'),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: () {
                  _urlController.text = 'ws://10.0.2.2:4000';
                },
                child: const Text('Emulator'),
              ),
            ]),
          ]),
        ),
        const SizedBox(height: 16),

        // Quick presets
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Quick Presets', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            _PresetButton(label: 'Production Server', url: 'ws://45.137.194.227:8083/ws', onTap: () { _urlController.text = 'ws://45.137.194.227:8083/ws'; }),
            _PresetButton(label: 'Emulator (host localhost)', url: 'ws://10.0.2.2:4000', onTap: () { _urlController.text = 'ws://10.0.2.2:4000'; }),
            _PresetButton(label: 'Local WiFi', url: 'ws://192.168.1.100:4000', onTap: () { _urlController.text = 'ws://192.168.1.100:4000'; }),
          ]),
        ),
        const SizedBox(height: 16),

        // Sound settings
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Sound & Alerts', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            SwitchListTile(
              title: const Text('Beep on alerts', style: TextStyle(color: Colors.white70, fontSize: 14)),
              subtitle: Text(_beepsEnabled ? 'Enabled — will beep when indicators arrive' : 'Disabled — silent',
                  style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 12)),
              value: _beepsEnabled,
              activeColor: const Color(0xFFE53935),
              onChanged: (v) {
                setState(() => _beepsEnabled = v);
                widget.race.setBeepsEnabled(v);
              },
            ),
          ]),
        ),
        const SizedBox(height: 16),

        // Connection info
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: const Color(0xFF1A1F2E), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF2A3040))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Connection Info', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            _InfoRow(label: 'Website', value: 'http://45.137.194.227:8083'),
            _InfoRow(label: 'WebSocket', value: 'ws://45.137.194.227:8083/ws'),
            _InfoRow(label: 'Server IP', value: '45.137.194.227'),
            _InfoRow(label: 'Port', value: '8083'),
            _InfoRow(label: 'Protocol', value: 'WebSocket (auto-reconnect)'),
            _InfoRow(label: 'Data rate', value: '10 Hz (telemetry + indicators)'),
          ]),
        ),
      ]))),
    );
  }
}

// ─── Widgets ──────────────────────────────────────────────────────────

class _StatChip extends StatelessWidget {
  final String label, value;
  const _StatChip({required this.label, required this.value});
  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Text(label, style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 11)),
      const SizedBox(height: 2),
      Text(value, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
    ]);
  }
}

class _GaugeRow extends StatelessWidget {
  final String label, unit;
  final double value, max;
  const _GaugeRow({required this.label, required this.value, required this.max, required this.unit});
  @override
  Widget build(BuildContext context) {
    final pct = (value / max).clamp(0.0, 1.0);
    return Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(children: [
      SizedBox(width: 80, child: Text(label, style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 13))),
      Expanded(child: LinearProgressIndicator(
        value: pct, backgroundColor: Colors.grey[800],
        valueColor: AlwaysStoppedAnimation(pct > 0.7 ? Colors.green : pct > 0.4 ? Colors.orange : const Color(0xFFE53935)),
        minHeight: 6, borderRadius: BorderRadius.circular(3),
      )),
      const SizedBox(width: 12),
      SizedBox(width: 60, child: Text('${value.toStringAsFixed(1)} $unit', textAlign: TextAlign.right, style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 12))),
    ]));
  }
}

class _GpsStat extends StatelessWidget {
  final String label, value;
  const _GpsStat({required this.label, required this.value});
  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Text(label, style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 10)),
      const SizedBox(height: 2),
      Text(value, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
    ]);
  }
}

class _PresetButton extends StatelessWidget {
  final String label, url;
  final VoidCallback onTap;
  const _PresetButton({required this.label, required this.url, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Padding(padding: const EdgeInsets.only(bottom: 8), child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(border: Border.all(color: const Color(0xFF2A3040)), borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          const Icon(Icons.dns, size: 16, color: Color(0xFF00E676)),
          const SizedBox(width: 8),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(color: Colors.white, fontSize: 13)),
            Text(url, style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 11)),
          ])),
          const Icon(Icons.arrow_forward, size: 16, color: Colors.white54),
        ]),
      ),
    ));
  }
}

class _InfoRow extends StatelessWidget {
  final String label, value;
  const _InfoRow({required this.label, required this.value});
  @override
  Widget build(BuildContext context) {
    return Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Row(children: [
      SizedBox(width: 100, child: Text(label, style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 12))),
      Expanded(child: Text(value, style: const TextStyle(color: Colors.white70, fontSize: 12))),
    ]));
  }
}

// ─── Trace Painter ────────────────────────────────────────────────────

class TracePainter extends CustomPainter {
  final List<GpsPoint> points;
  TracePainter(this.points);
  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2) return;
    final paint = Paint()..color = const Color(0xFF00E676)..strokeWidth = 4..strokeCap = StrokeCap.round..strokeJoin = StrokeJoin.round;
    double minLat = points.first.lat, maxLat = points.first.lat, minLon = points.first.lon, maxLon = points.first.lon;
    for (final p in points) {
      minLat = math.min(minLat, p.lat); maxLat = math.max(maxLat, p.lat);
      minLon = math.min(minLon, p.lon); maxLon = math.max(maxLon, p.lon);
    }
    final latRange = (maxLat - minLat).clamp(1e-9, double.infinity);
    final lonRange = (maxLon - minLon).clamp(1e-9, double.infinity);
    final scale = math.min(size.width / lonRange * 0.8, size.height / latRange * 0.8);
    final offsetX = (size.width - lonRange * scale) / 2;
    final offsetY = (size.height - latRange * scale) / 2;
    for (int i = 0; i < points.length - 1; i++) {
      final p1 = points[i], p2 = points[i + 1];
      canvas.drawLine(
        Offset(offsetX + (p1.lon - minLon) * scale, offsetY + (maxLat - p1.lat) * scale),
        Offset(offsetX + (p2.lon - minLon) * scale, offsetY + (maxLat - p2.lat) * scale),
        paint,
      );
    }
    final last = points.last;
    canvas.drawCircle(Offset(offsetX + (last.lon - minLon) * scale, offsetY + (maxLat - last.lat) * scale), 8, Paint()..color = const Color(0xFFE53935));
  }
  @override
  bool shouldRepaint(covariant TracePainter oldDelegate) => true;
}
