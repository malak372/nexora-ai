import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'core/theme/app_theme.dart';
import 'features/auth/pages/login_page.dart';
import 'features/auth/pages/register_page.dart';
import 'features/home/pages/home_page.dart';
import 'features/guest_idea/pages/guest_generate_idea_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await dotenv.load(fileName: '.env');

  runApp(const VoxidenceApp());
}

class VoxidenceApp extends StatelessWidget {
  const VoxidenceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Voxidence',

      debugShowCheckedModeBanner: false,

      theme: AppTheme.light,

      initialRoute: '/',

      routes: {
        '/': (_) => const HomePage(),

        '/login': (_) => const LoginPage(),

        '/register': (_) => const RegisterPage(),

        '/generate': (_) => const GuestGenerateIdeaPage(),
      },
    );
  }
}
