import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_reactive_ble/flutter_reactive_ble.dart';
import 'package:permission_handler/permission_handler.dart';
import 'models.dart';

class BlePeer {
  const BlePeer(this.id, this.name, this.rssi);
  final String id, name;
  final int rssi;
}

class BleNotifyChannel {
  const BleNotifyChannel(this.service, this.characteristic);
  final String service, characteristic;
  String get label => '$service / $characteristic';
}

/// Exact packet mappings are entered from the firmware protocol. Unknown data
/// is observable but cannot trigger playback. No guessed UUIDs/opcodes.
class GesturePacketMap {
  GesturePacketMap(Map<AccessoryGesture, String> values) {
    for (final entry in values.entries) {
      final packet = normalize(entry.value);
      if (packet.isEmpty ||
          packet.length > 128 ||
          packets.containsValue(packet)) {
        throw const FormatException('三个按键数据必须不同，且每条为 1–64 字节十六进制。');
      }
      packets[entry.key] = packet;
    }
    if (packets.length != 3) throw const FormatException('请配置三个按键的数据。');
  }
  final Map<AccessoryGesture, String> packets = {};
  static String normalize(String input) {
    final value = input.replaceAll(RegExp(r'\s+'), '').toLowerCase();
    if (value.length.isOdd || !RegExp(r'^[0-9a-f]*$').hasMatch(value)) {
      throw const FormatException('请输入完整的十六进制字节，例如 01 00。');
    }
    return value;
  }

  static String hex(List<int> bytes) =>
      bytes.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
  AccessoryGesture? decode(List<int> bytes) {
    if (bytes.isEmpty || bytes.length > 64) return null;
    final value = hex(bytes);
    for (final entry in packets.entries) {
      if (entry.value == value) return entry.key;
    }
    return null;
  }
}

class AccessoryBle extends ChangeNotifier {
  FlutterReactiveBle? _client;
  FlutterReactiveBle get _ble => _client ??= FlutterReactiveBle();
  StreamSubscription<DiscoveredDevice>? _scan;
  StreamSubscription<ConnectionStateUpdate>? _connection;
  StreamSubscription<List<int>>? _notification;
  Timer? _timeout;
  int _generation = 0;
  bool _disposed = false;
  AccessoryStatus status = AccessoryStatus.disconnected;
  final Map<String, BlePeer> peers = {};
  List<BleNotifyChannel> channels = [];
  BlePeer? selected;
  BleNotifyChannel? channel;
  GesturePacketMap? mapping;
  String message = '选择你的饰品，使用真实蓝牙连接。';
  String lastPacket = '';
  DateTime? _lastGesture;
  final _gestures = StreamController<AccessoryGesture>.broadcast();
  Stream<AccessoryGesture> get gestures => _gestures.stream;
  bool get supported =>
      !kIsWeb &&
      [TargetPlatform.android, TargetPlatform.iOS]
          .contains(defaultTargetPlatform);
  bool get controlsReady =>
      status == AccessoryStatus.connected && channel != null && mapping != null;
  void changed() {
    if (!_disposed) notifyListeners();
  }

  Future<void> scan() async {
    await disconnect(announce: false);
    if (!supported) {
      message = '真实蓝牙请在 Android 或 iOS App 中使用。';
      changed();
      return;
    }
    final generation = ++_generation;
    peers.clear();
    status = AccessoryStatus.discovering;
    message = '正在申请蓝牙权限…';
    changed();
    try {
      if (defaultTargetPlatform == TargetPlatform.android) {
        final sdk = await const MethodChannel('harbeat/platform')
                .invokeMethod<int>('sdkInt') ??
            31;
        final permissions = sdk >= 31
            ? [Permission.bluetoothScan, Permission.bluetoothConnect]
            : [Permission.locationWhenInUse];
        final result = await permissions.request();
        if (result.values.any((v) => !v.isGranted)) {
          throw StateError('蓝牙权限未允许，请在系统设置中开启后重试。');
        }
      }
      if (generation != _generation || _disposed) return;
      final ready = await _ble.statusStream
          .firstWhere((v) => v != BleStatus.unknown)
          .timeout(const Duration(seconds: 8));
      if (generation != _generation || _disposed) return;
      if (ready != BleStatus.ready) {
        throw StateError(switch (ready) {
          BleStatus.poweredOff => '请先打开手机蓝牙。',
          BleStatus.locationServicesDisabled => '此 Android 版本扫描蓝牙需要打开定位服务。',
          BleStatus.unauthorized => '系统未允许蓝牙访问。',
          _ => '手机蓝牙暂不可用，请重试。'
        });
      }
      message = '正在查找附近设备（15 秒）…';
      changed();
      _scan = _ble.scanForDevices(
          withServices: const [],
          scanMode: ScanMode.lowLatency).listen((device) {
        if (generation != _generation || _disposed) return;
        peers[device.id] = BlePeer(device.id,
            device.name.isEmpty ? '未命名蓝牙设备' : device.name, device.rssi);
        changed();
      }, onError: (_) {
        if (generation == _generation) {
          stopScan();
          message = '扫描失败，请检查蓝牙与权限。';
          changed();
        }
      });
      _timeout = Timer(const Duration(seconds: 15), () {
        if (generation == _generation) stopScan();
      });
    } catch (error) {
      if (generation != _generation || _disposed) return;
      status = AccessoryStatus.disconnected;
      message =
          error is StateError ? error.message.toString() : '无法开始扫描，请检查蓝牙权限后重试。';
      changed();
    }
  }

  void stopScan() {
    _generation++;
    _timeout?.cancel();
    unawaited(_scan?.cancel());
    _scan = null;
    if (status == AccessoryStatus.discovering) {
      status = AccessoryStatus.disconnected;
    }
    message = peers.isEmpty ? '未发现设备，请让饰品进入广播状态后重试。' : '请选择你自己的设备。';
    changed();
  }

  Future<void> connect(BlePeer peer) async {
    await disconnect(announce: false);
    final generation = ++_generation;
    selected = peer;
    status = AccessoryStatus.confirming;
    message = '正在连接 ${peer.name}…';
    changed();
    _connection = _ble
        .connectToDevice(
            id: peer.id, connectionTimeout: const Duration(seconds: 12))
        .listen((update) async {
      if (generation != _generation || _disposed) return;
      if (update.connectionState == DeviceConnectionState.connected) {
        try {
          await _ble.discoverAllServices(peer.id);
          final services = await _ble.getDiscoveredServices(peer.id);
          if (generation != _generation || _disposed) return;
          channels = [
            for (final service in services)
              for (final characteristic in service.characteristics)
                if (characteristic.isNotifiable || characteristic.isIndicatable)
                  BleNotifyChannel(
                      service.id.toString(), characteristic.id.toString())
          ];
          status = AccessoryStatus.connected;
          message =
              channels.isEmpty ? '蓝牙已连接；设备未提供通知特征。' : '蓝牙已连接；请按固件协议设置快捷控制。';
          changed();
        } catch (_) {
          if (generation == _generation) {
            await disconnect();
            message = '读取设备服务失败，请重试。';
            changed();
          }
        }
      } else if (update.connectionState == DeviceConnectionState.disconnected) {
        await disconnect();
        message = '设备已断开，手机继续播放。';
        changed();
      }
    }, onError: (_) async {
      if (generation == _generation) {
        await disconnect();
        message = '连接失败，请让设备靠近后重试。';
        changed();
      }
    });
  }

  Future<void> bind(
      BleNotifyChannel selectedChannel, GesturePacketMap packetMap) async {
    if (status != AccessoryStatus.connected || selected == null) return;
    if (!channels.contains(selectedChannel)) throw StateError('通知特征不属于当前设备');
    await _notification?.cancel();
    channel = selectedChannel;
    mapping = packetMap;
    _lastGesture = null;
    final generation = _generation;
    _notification = _ble
        .subscribeToCharacteristic(QualifiedCharacteristic(
            deviceId: selected!.id,
            serviceId: Uuid.parse(channel!.service),
            characteristicId: Uuid.parse(channel!.characteristic)))
        .listen((packet) {
      if (generation != _generation || _disposed) return;
      lastPacket = GesturePacketMap.hex(packet.take(64).toList());
      final gesture = mapping?.decode(packet);
      final now = DateTime.now();
      if (gesture != null &&
          (_lastGesture == null ||
              now.difference(_lastGesture!) >=
                  const Duration(milliseconds: 200))) {
        _lastGesture = now;
        _gestures.add(gesture);
        message = '已收到${gesture.label}';
      } else if (gesture == null) {
        message = '收到未映射数据，未执行快捷动作。';
      }
      changed();
    }, onError: (_) {
      if (generation == _generation) {
        channel = null;
        mapping = null;
        message = '通知订阅失败，请重新设置或连接。';
        changed();
      }
    });
    message = '已订阅按键通知，等待设备动作。';
    changed();
  }

  Future<void> disconnect({bool announce = true}) async {
    _generation++;
    _timeout?.cancel();
    status = AccessoryStatus.disconnected;
    selected = null;
    channel = null;
    mapping = null;
    channels = [];
    lastPacket = '';
    final scan = _scan;
    final connection = _connection;
    final notification = _notification;
    _scan = null;
    _connection = null;
    _notification = null;
    await notification?.cancel();
    await scan?.cancel();
    await connection?.cancel();
    if (announce) message = '饰品已断开，手机继续播放。';
    changed();
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(disconnect(announce: false));
    unawaited(_gestures.close());
    super.dispose();
  }
}
