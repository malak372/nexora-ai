/**
 * Composes the main public landing page for the Nexora platform.
 *
 * The page combines all public-facing sections in a clear visual order:
 * - Hero introduction.
 * - Nexora workflow.
 * - Platform overview.
 * - Supported domains.
 * - Featured idea previews.
 * - Final contact call-to-action.
 *
 * @component
 * @returns {JSX.Element} The complete Nexora public home page.
 *
 * @author Eman
 */

import AboutNexoraSection from '../../features/home/components/AboutNexoraSection';
import DomainsSection from '../../features/home/components/DomainsSection';
import FeaturedIdeasSection from '../../features/home/components/FeaturedIdeasSection';
import HeroSection from '../../features/home/components/HeroSection';
import HomeCtaSection from '../../features/home/components/HomeCtaSection';
import HowItWorksSection from '../../features/home/components/HowItWorksSection';

/**
 * Displays the full public Nexora landing page.
 *
 * @returns {JSX.Element}
 */
export default function HomePage() {
    return (
        <>
            <HeroSection />
            <HowItWorksSection />
            <AboutNexoraSection />
            <DomainsSection />
            <FeaturedIdeasSection />
            <HomeCtaSection />
        </>
    );
}