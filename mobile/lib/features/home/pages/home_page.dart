// Main public Home screen for the Voxidence mobile application.
//
// The page keeps the mobile-first visual design while using the same public
// backend flows as the web application for featured publications and Contact Us.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../widgets/backend_contact_section.dart';
import '../widgets/contact_footer.dart';
import '../widgets/featured_publications_section.dart';
import '../widgets/hero_section.dart';
import '../widgets/home_background.dart';
import '../widgets/home_bottom_nav.dart';
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

  void _openGenerate() {
    Navigator.pushNamed(context, '/generate');
  }

  void _openLogin() {
    Navigator.pushNamed(context, '/login');
  }

  void _openRegister() {
    Navigator.pushNamed(context, '/register');
  }

  void _openProtectedArea() {
    Navigator.pushNamed(context, '/login');
  }

  void _openPublicPublication(String publicationId) {
    Navigator.pushNamed(context, '/publications/$publicationId');
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
                padding: const EdgeInsets.only(bottom: 118),
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
                          child: BackendFeaturedIdeasSection(
                            onViewIdeaPressed: _openPublicPublication,
                            onCreateAccountPressed: _openRegister,
                          ),
                        ),
                        KeyedSubtree(
                          key: _contactKey,
                          child: BackendContactSection(
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
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 540),
                child: HomeBottomNav(
                  onHomePressed: _scrollHome,
                  onDiscoverPressed: () {
                    _scrollTo(_featuredIdeasKey);
                  },
                  onGeneratePressed: _openGenerate,
                  onMyIdeasPressed: _openProtectedArea,
                  onProfilePressed: _openProtectedArea,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
