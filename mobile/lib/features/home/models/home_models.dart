import 'package:flutter/material.dart';

class HeroStage {
  const HeroStage({
    required this.title,
    required this.description,
    required this.assetPath,
  });

  final String title;
  final String description;
  final String assetPath;
}

class WorkflowStep {
  const WorkflowStep({
    required this.number,
    required this.title,
    required this.description,
    required this.icon,
  });

  final int number;
  final String title;
  final String description;
  final IconData icon;
}

class DomainItem {
  const DomainItem({
    required this.title,
    required this.description,
    required this.icon,
  });

  final String title;
  final String description;
  final IconData icon;
}

class FeaturedIdea {
  const FeaturedIdea({
    required this.title,
    required this.summary,
    required this.domain,
    required this.score,
  });

  final String title;
  final String summary;
  final String domain;
  final double score;
}

abstract final class HomeData {
  static const List<HeroStage> heroStages = [
    HeroStage(
      title: 'Collect real community signals',
      description:
          'Public conversations, reviews, developer communities, and recurring needs flow into one evidence source.',
      assetPath: 'assets/images/hero-stages/01-collect-signals.svg',
    ),
    HeroStage(
      title: 'Turn signals into structured evidence',
      description:
          'The pipeline cleans the data, runs NLP analysis, detects patterns, and prepares grounded context.',
      assetPath: 'assets/images/hero-stages/02-evidence-pipeline.svg',
    ),
    HeroStage(
      title: 'Compare AI directions with evidence',
      description:
          'Multiple candidate directions are scored against signal strength, community demand, and potential impact.',
      assetPath: 'assets/images/hero-stages/03-compare-directions.svg',
    ),
    HeroStage(
      title: 'Shape the strongest project opportunity',
      description:
          'The selected direction becomes a focused, evidence-backed project brief that is ready to build.',
      assetPath: 'assets/images/hero-stages/04-selected-opportunity.svg',
    ),
  ];

  static const List<WorkflowStep> workflowSteps = [
    WorkflowStep(
      number: 1,
      title: 'Listen to communities',
      description:
          'Voxidence gathers relevant public conversations from trusted digital communities and open platforms.',
      icon: Icons.travel_explore_rounded,
    ),
    WorkflowStep(
      number: 2,
      title: 'Discover hidden patterns',
      description:
          'NLP detects repeated needs, urgency, evidence strength, and locally relevant opportunities.',
      icon: Icons.manage_search_rounded,
    ),
    WorkflowStep(
      number: 3,
      title: 'Generate and compare',
      description:
          'Several AI models propose solutions, then a comparative judge selects the strongest candidate.',
      icon: Icons.psychology_alt_outlined,
    ),
    WorkflowStep(
      number: 4,
      title: 'Shape a real project',
      description:
          'The final idea is organized into a clear problem, objectives, target users, and implementation direction.',
      icon: Icons.rocket_launch_outlined,
    ),
  ];

  static const List<DomainItem> domains = [
    DomainItem(
      title: 'Education',
      description: 'Smarter learning experiences',
      icon: Icons.school_outlined,
    ),
    DomainItem(
      title: 'Health',
      description: 'Accessible digital care',
      icon: Icons.favorite_border_rounded,
    ),
    DomainItem(
      title: 'Business',
      description: 'Better everyday operations',
      icon: Icons.business_center_outlined,
    ),
    DomainItem(
      title: 'Environment',
      description: 'Sustainable local solutions',
      icon: Icons.eco_outlined,
    ),
    DomainItem(
      title: 'Community',
      description: 'Services people actually need',
      icon: Icons.groups_2_outlined,
    ),
    DomainItem(
      title: 'Technology',
      description: 'Tools for emerging challenges',
      icon: Icons.memory_outlined,
    ),
  ];

  static const List<FeaturedIdea> featuredIdeas = [
    FeaturedIdea(
      title: 'CampusFlow',
      summary:
          'A university coordination platform designed around repeated student complaints about scattered academic updates and fragmented service communication.',
      domain: 'Education',
      score: 92,
    ),
    FeaturedIdea(
      title: 'QueueSense',
      summary:
          'A lightweight service-queue visibility solution inspired by recurring complaints about uncertain waiting times in local service locations.',
      domain: 'Community Services',
      score: 89,
    ),
    FeaturedIdea(
      title: 'DevContext',
      summary:
          'A developer workspace assistant focused on recurring context-switching and fragmented debugging workflows reported across technical communities.',
      domain: 'Software Development',
      score: 87,
    ),
  ];
}
