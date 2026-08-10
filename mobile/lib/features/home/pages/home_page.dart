/// Main public Home screen for the Voxidence mobile application.
///
/// @author Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../widgets/contact_footer.dart';
import '../widgets/hero_section.dart';
import '../widgets/home_background.dart';
import '../widgets/home_navbar.dart';
import '../widgets/home_sections.dart';
import '../widgets/how_it_works_section.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final GlobalKey _homeKey = GlobalKey();
  final GlobalKey _howItWorksKey = GlobalKey();
  final GlobalKey _aboutKey = GlobalKey();
  final GlobalKey _domainsKey = GlobalKey();
  final GlobalKey _featuredIdeasKey = GlobalKey();
  final GlobalKey _contactKey = GlobalKey();

  Future<void> scrollTo(String sectionId) async {
    final GlobalKey? targetKey;

    switch (sectionId) {
      case 'home':
        targetKey = _homeKey;
        break;
      case 'how-it-works':
        targetKey = _howItWorksKey;
        break;
      case 'about':
        targetKey = _aboutKey;
        break;
      case 'domains':
        targetKey = _domainsKey;
        break;
      case 'featured-ideas':
        targetKey = _featuredIdeasKey;
        break;
      case 'contact':
        targetKey = _contactKey;
        break;
      default:
        targetKey = null;
    }

    final targetContext = targetKey?.currentContext;

    if (targetContext == null) {
      return;
    }

    await Scrollable.ensureVisible(
      targetContext,
      duration: const Duration(milliseconds: 520),
      curve: Curves.easeInOutCubic,
      alignment: 0.02,
    );
  }

  void showRouteMessage(String target) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          backgroundColor: AppColors.primaryDeep,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          content: Text(
            '$target screen will be connected with Flutter routing.',
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      );
  }

  void openGenerate() {
    showRouteMessage('Generate Idea');
  }

  void openLogin() {
    Navigator.pushNamed(context, '/login');
  }

  void openRegister() {
    Navigator.pushNamed(context, '/register');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          const Positioned.fill(child: HomeBackground()),
          SafeArea(
            bottom: false,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 540),
                child: Column(
                  children: [
                    HomeNavbar(
                      onHomePressed: () => scrollTo('home'),
                      onHowItWorksPressed: () => scrollTo('how-it-works'),
                      onAboutPressed: () => scrollTo('about'),
                      onDomainsPressed: () => scrollTo('domains'),
                      onIdeasPressed: () => scrollTo('featured-ideas'),
                      onContactPressed: () => scrollTo('contact'),
                      onGeneratePressed: openGenerate,
                      onSignInPressed: openLogin,
                      onRegisterPressed: openRegister,
                    ),
                    Expanded(
                      child: SingleChildScrollView(
                        physics: const BouncingScrollPhysics(),
                        keyboardDismissBehavior:
                            ScrollViewKeyboardDismissBehavior.onDrag,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            KeyedSubtree(
                              key: _homeKey,
                              child: HeroSection(
                                onGeneratePressed: openGenerate,
                                onExplorePressed: () {
                                  scrollTo('how-it-works');
                                },
                              ),
                            ),
                            KeyedSubtree(
                              key: _howItWorksKey,
                              child: const MobileHowItWorksSection(),
                            ),
                            KeyedSubtree(
                              key: _aboutKey,
                              child: const AboutSection(),
                            ),
                            KeyedSubtree(
                              key: _domainsKey,
                              child: const DomainsSection(),
                            ),
                            KeyedSubtree(
                              key: _featuredIdeasKey,
                              child: FeaturedIdeasSection(
                                onViewIdeaPressed: (ideaTitle) {
                                  showRouteMessage(
                                    'Publication Details: $ideaTitle',
                                  );
                                },
                                onExploreAllPressed: () {
                                  showRouteMessage('Discover Ideas');
                                },
                              ),
                            ),
                            KeyedSubtree(
                              key: _contactKey,
                              child: ContactSection(
                                onGetStartedPressed: openRegister,
                              ),
                            ),
                            HomeFooter(
                              onHomePressed: () => scrollTo('home'),
                              onHowItWorksPressed: () =>
                                  scrollTo('how-it-works'),
                              onAboutPressed: () => scrollTo('about'),
                              onDomainsPressed: () => scrollTo('domains'),
                              onIdeasPressed: () => scrollTo('featured-ideas'),
                              onContactPressed: () => scrollTo('contact'),
                            ),
                            SizedBox(
                              height: MediaQuery.paddingOf(context).bottom + 10,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
