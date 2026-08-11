// Main public Home screen for the Voxidence mobile application.
//
// @author Eman

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
  final ScrollController _scrollController = ScrollController();

  final GlobalKey _homeKey = GlobalKey();

  final GlobalKey _howItWorksKey = GlobalKey();

  final GlobalKey _aboutKey = GlobalKey();

  final GlobalKey _domainsKey = GlobalKey();

  final GlobalKey _featuredIdeasKey = GlobalKey();

  final GlobalKey _contactKey = GlobalKey();

  @override
  void dispose() {
    _scrollController.dispose();

    super.dispose();
  }

  Future<void> _scrollTo(GlobalKey key) async {
    final targetContext = key.currentContext;

    if (targetContext == null) {
      return;
    }

    await Scrollable.ensureVisible(
      targetContext,
      duration: const Duration(milliseconds: 500),
      curve: Curves.easeInOutCubic,
      alignment: 0.02,
    );
  }

  Future<void> _scrollHome() async {
    if (!_scrollController.hasClients) {
      return;
    }

    await _scrollController.animateTo(
      0,
      duration: const Duration(milliseconds: 450),
      curve: Curves.easeInOutCubic,
    );
  }

  void _showRouteMessage(String target) {
    final messenger = ScaffoldMessenger.of(context);

    final screenWidth = MediaQuery.sizeOf(context).width;

    final snackWidth = screenWidth > 362 ? 330.0 : screenWidth - 32;

    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          width: snackWidth,
          elevation: 8,
          duration: const Duration(milliseconds: 1500),
          backgroundColor: AppColors.primaryDeep,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          content: Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.route_outlined,
                  size: 15,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '$target will be connected with Flutter routing.',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11.4,
                    height: 1.25,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
  }

  void _openGenerate() {
    Navigator.pushNamed(context, '/generate');
  }

  void _openLogin() {
    Navigator.pushNamed(context, '/login');
  }

  void _openRegister() {
    Navigator.pushNamed(context, '/register');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          const Positioned.fill(child: HomeBackground()),
          Positioned.fill(
            child: SafeArea(
              bottom: false,
              child: SingleChildScrollView(
                controller: _scrollController,
                physics: const BouncingScrollPhysics(),
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                child: Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 540),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        HomeNavbar(
                          onHomePressed: _scrollHome,
                          onHowItWorksPressed: () {
                            _scrollTo(_howItWorksKey);
                          },
                          onAboutPressed: () {
                            _scrollTo(_aboutKey);
                          },
                          onDomainsPressed: () {
                            _scrollTo(_domainsKey);
                          },
                          onIdeasPressed: () {
                            _scrollTo(_featuredIdeasKey);
                          },
                          onContactPressed: () {
                            _scrollTo(_contactKey);
                          },
                          onGeneratePressed: _openGenerate,
                          onSignInPressed: _openLogin,
                          onRegisterPressed: _openRegister,
                        ),

                        KeyedSubtree(
                          key: _homeKey,
                          child: HeroSection(
                            onGeneratePressed: _openGenerate,
                            onExplorePressed: () {
                              _scrollTo(_howItWorksKey);
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
                              _showRouteMessage(
                                'Publication Details: $ideaTitle',
                              );
                            },
                            onExploreAllPressed: () {
                              _showRouteMessage('Discover Ideas');
                            },
                          ),
                        ),

                        KeyedSubtree(
                          key: _contactKey,
                          child: ContactSection(
                            onGetStartedPressed: _openRegister,
                          ),
                        ),

                        HomeFooter(
                          onHomePressed: _scrollHome,
                          onHowItWorksPressed: () {
                            _scrollTo(_howItWorksKey);
                          },
                          onAboutPressed: () {
                            _scrollTo(_aboutKey);
                          },
                          onDomainsPressed: () {
                            _scrollTo(_domainsKey);
                          },
                          onIdeasPressed: () {
                            _scrollTo(_featuredIdeasKey);
                          },
                          onContactPressed: () {
                            _scrollTo(_contactKey);
                          },
                        ),

                        SizedBox(
                          height: MediaQuery.paddingOf(context).bottom + 20,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
