part of 'app.dart';

class _NetworkNotice extends StatelessWidget {
  const _NetworkNotice(this.message, {required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: HardCard(
          color: const Color(0xFFFFD4C9),
          shadow: false,
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(message),
            const SizedBox(height: 8),
            HardButton(label: '重试', color: HB.white, onPressed: onRetry),
          ])));
}

class BackendScreen extends StatefulWidget {
  const BackendScreen(this.c, {super.key});
  final AppController c;
  @override
  State<BackendScreen> createState() => _BackendScreenState();
}

class _BackendScreenState extends State<BackendScreen> {
  late final address = TextEditingController(
      text: widget.c.remoteRepository?.config.baseUri.toString() ??
          BackendConfig.defaultAddress);
  late final username = TextEditingController(text: widget.c.accountName ?? '');
  final password = TextEditingController();
  final confirmPassword = TextEditingController();
  final token = TextEditingController();
  late BackendApi api =
      widget.c.remoteRepository?.config.api ?? BackendApi.legacy;
  late bool useToken = api == BackendApi.v2;
  bool registering = false;
  bool busy = false;
  String? error;
  String? result;

  @override
  void dispose() {
    address.dispose();
    username.dispose();
    password.dispose();
    confirmPassword.dispose();
    token.dispose();
    super.dispose();
  }

  Future<void> connect() async {
    if (busy) return;
    if (registering && !useToken) {
      final message = username.text.trim().isEmpty || password.text.isEmpty
          ? '请输入账号和密码。'
          : confirmPassword.text.isEmpty
              ? '请再次输入密码。'
              : password.text != confirmPassword.text
                  ? '两次输入的密码不一致，请检查。'
                  : null;
      if (message != null) {
        setState(() {
          error = message;
          result = null;
        });
        return;
      }
    }
    FocusScope.of(context).unfocus();
    var accountCreated = false;
    setState(() {
      busy = true;
      error = null;
      result = null;
    });
    try {
      if (useToken) {
        final existing = widget.c.remoteRepository?.config;
        final config = BackendConfig(address.text, api: api, token: token.text);
        // Reuse a credential only for exactly the same server and API.
        final next =
            token.text.trim().isEmpty && existing?.scope == config.scope
                ? existing!
                : config;
        await widget.c.configureBackend(next);
      } else if (registering) {
        final session = await widget.c.createBackendAccount(
            BackendConfig(address.text, api: api),
            username: username.text,
            password: password.text);
        accountCreated = true;
        if (!mounted) return;
        setState(() {
          registering = false;
          result = '账号已创建，正在加载曲库…';
        });
        await widget.c.configureBackend(session);
      } else {
        await widget.c.loginBackend(BackendConfig(address.text, api: api),
            username: username.text, password: password.text);
      }
      if (!mounted) return;
      setState(() {
        error = widget.c.catalogError;
        result = accountCreated
            ? error != null
                ? '注册成功。曲库暂时加载失败，可打开在线曲库重试。'
                : widget.c.cloudTracks.isEmpty
                    ? '注册成功 · 已自动登录。当前账号的云端曲库暂无歌曲。'
                    : '注册成功 · 已自动登录，加载 ${widget.c.cloudTracks.length} 首歌曲'
            : error == null
                ? '已连接 · 加载 ${widget.c.cloudTracks.length} 首歌曲'
                : null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          result = accountCreated ? '账号已创建，请使用刚才的账号登录。' : null;
          error = e is BackendException ? e.message : '连接失败，请重试。';
        });
      }
    } finally {
      if (mounted) {
        password.clear();
        confirmPassword.clear();
        token.clear();
        setState(() => busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
      canPop: !busy,
      child: Scaffold(
          appBar: AppBar(title: const Text('音乐服务')),
          body: PageFrame(
              label: 'MUSIC / CONNECT',
              title: 'YOUR MUSIC.\nCONNECTED.',
              children: [
                Text(
                    registering
                        ? '创建 HarBeat 账号，开启自己的音乐空间。'
                        : '登录 HarBeat，打开自己的云端曲库。',
                    style: const TextStyle(fontWeight: FontWeight.w900)),
                const SizedBox(height: 8),
                Text('服务：${address.text}',
                    style: const TextStyle(fontSize: 12)),
                const SizedBox(height: 8),
                const Text('密码不会保存。登录凭据加密保存在本机，到期自动续期；可随时退出登录。收藏和歌单保存在本机。',
                    style: TextStyle(fontSize: 12)),
                if (widget.c.hasBackendSession) ...[
                  const SizedBox(height: 16),
                  HardCard(
                      color: HB.acid,
                      shadow: false,
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text('当前账号：${widget.c.accountName ?? '已通过凭据连接'}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w900)),
                            TextButton(
                                onPressed: busy
                                    ? null
                                    : () async {
                                        setState(() {
                                          busy = true;
                                          error = null;
                                          result = null;
                                        });
                                        try {
                                          await widget.c.logoutBackend();
                                          if (!mounted) return;
                                          username.clear();
                                          password.clear();
                                          confirmPassword.clear();
                                          token.clear();
                                          setState(() {
                                            result = '已退出登录。本地音乐和歌单继续保留。';
                                          });
                                        } catch (e) {
                                          if (mounted) {
                                            setState(() => error =
                                                e is BackendException
                                                    ? e.message
                                                    : '退出失败，请重试。');
                                          }
                                        } finally {
                                          if (mounted) {
                                            setState(() => busy = false);
                                          }
                                        }
                                      },
                                child: const Text('退出登录')),
                          ])),
                ],
                if (widget.c.sessionWarning != null)
                  Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(widget.c.sessionWarning!)),
                const SizedBox(height: 24),
                if (api == BackendApi.legacy && !useToken) ...[
                  Row(children: [
                    Expanded(
                        child: Text(registering ? '注册账号' : '账号登录',
                            style: const TextStyle(
                                fontSize: 20, fontWeight: FontWeight.w900))),
                    TextButton(
                        key: const ValueKey('backend-auth-mode'),
                        onPressed: busy
                            ? null
                            : () => setState(() {
                                  registering = !registering;
                                  password.clear();
                                  confirmPassword.clear();
                                  error = null;
                                  result = null;
                                }),
                        child: Text(registering ? '已有账号？去登录' : '没有账号？注册账号')),
                  ]),
                  const SizedBox(height: 16),
                ],
                if (!useToken) ...[
                  TextField(
                      key: const ValueKey('backend-username'),
                      controller: username,
                      enabled: !busy,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                          labelText: '账号', border: OutlineInputBorder())),
                  const SizedBox(height: 16),
                  TextField(
                      key: const ValueKey('backend-password'),
                      controller: password,
                      enabled: !busy,
                      obscureText: true,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: registering
                          ? TextInputAction.next
                          : TextInputAction.done,
                      onSubmitted: (_) {
                        if (!busy && !registering) connect();
                      },
                      decoration: const InputDecoration(
                          labelText: '密码', border: OutlineInputBorder())),
                  if (registering) ...[
                    const SizedBox(height: 16),
                    TextField(
                        key: const ValueKey('backend-confirm-password'),
                        controller: confirmPassword,
                        enabled: !busy,
                        obscureText: true,
                        autocorrect: false,
                        enableSuggestions: false,
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) {
                          if (!busy) connect();
                        },
                        decoration: const InputDecoration(
                            labelText: '确认密码', border: OutlineInputBorder())),
                  ],
                ] else
                  TextField(
                      key: const ValueKey('backend-token'),
                      controller: token,
                      enabled: !busy,
                      obscureText: true,
                      autocorrect: false,
                      enableSuggestions: false,
                      decoration: InputDecoration(
                          labelText: '访问凭据（Bearer Token）',
                          hintText: widget.c.remoteRepository?.config.token
                                      .isNotEmpty ==
                                  true
                              ? '留空沿用当前服务的会话凭据'
                              : '由后端提供',
                          border: const OutlineInputBorder())),
                const SizedBox(height: 20),
                HardButton(
                    label: busy
                        ? '连接中…'
                        : useToken
                            ? '连接并加载曲库'
                            : registering
                                ? '注册并进入曲库'
                                : '登录并加载曲库',
                    color: HB.acid,
                    onPressed: busy ? null : connect),
                if (busy)
                  const Padding(
                      padding: EdgeInsets.only(top: 16),
                      child: LinearProgressIndicator()),
                if (error != null)
                  Padding(
                      padding: const EdgeInsets.only(top: 16),
                      child: Text(error!,
                          style: const TextStyle(color: Color(0xFF9F2915)))),
                if (result != null && !busy) ...[
                  const SizedBox(height: 16),
                  Text(result!),
                  const SizedBox(height: 12),
                  if (widget.c.hasBackendSession)
                    HardButton(
                        label: '打开在线曲库',
                        onPressed: () {
                          widget.c.setTab(1);
                          widget.c.setMusicSection(0);
                          Navigator.pop(context);
                        }),
                ],
                if (api == BackendApi.legacy)
                  TextButton(
                      onPressed: busy
                          ? null
                          : () => setState(() {
                                useToken = !useToken;
                                registering = false;
                                password.clear();
                                confirmPassword.clear();
                                token.clear();
                                error = null;
                                result = null;
                              }),
                      child: Text(useToken ? '使用账号密码登录' : '使用已有访问凭据')),
                const SizedBox(height: 12),
                ExpansionTile(
                    title: const Text('连接设置'),
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: const EdgeInsets.only(bottom: 16),
                    children: [
                      TextField(
                          key: const ValueKey('backend-address'),
                          controller: address,
                          enabled: !busy,
                          autocorrect: false,
                          keyboardType: TextInputType.url,
                          onChanged: (_) => setState(() {
                                error = null;
                                result = null;
                              }),
                          decoration: const InputDecoration(
                              labelText: '服务地址',
                              hintText: 'https://你的服务地址',
                              border: OutlineInputBorder())),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<BackendApi>(
                          initialValue: api,
                          decoration: const InputDecoration(
                              labelText: '接口版本', border: OutlineInputBorder()),
                          items: const [
                            DropdownMenuItem(
                                value: BackendApi.legacy,
                                child: Text('旧版 · 当前仓库已有接口')),
                            DropdownMenuItem(
                                value: BackendApi.v2,
                                child: Text('第二版 · 需服务端已部署')),
                          ],
                          onChanged: busy
                              ? null
                              : (value) => setState(() {
                                    api = value!;
                                    useToken = api == BackendApi.v2;
                                    registering = false;
                                    password.clear();
                                    confirmPassword.clear();
                                    token.clear();
                                    error = null;
                                    result = null;
                                  })),
                    ]),
                const SizedBox(height: 26),
                HardButton(
                    label: '使用内置示例',
                    color: HB.white,
                    onPressed: busy
                        ? null
                        : () async {
                            setState(() {
                              busy = true;
                              error = null;
                              result = null;
                            });
                            await widget.c.useDemoCatalog();
                            if (context.mounted) Navigator.pop(context);
                          }),
              ])));
}
