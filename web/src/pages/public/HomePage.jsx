/**
 * Displays the complete public Voxidence landing experience.
 *
 * Every public section is rendered over one continuous visual background so
 * the transition from the hero into the workflow, about, domains, featured
 * ideas, and contact areas never creates visible colour bands.
 *
 * @returns {JSX.Element} The public Voxidence home page.
 *
 * @author Eman
 */
import AboutNexoraSection from '../../features/home/components/AboutNexoraSection';
import DomainsSection from '../../features/home/components/DomainsSection';
import FeaturedIdeasSection from '../../features/home/components/FeaturedIdeasSection';
import HeroSection from '../../features/home/components/HeroSection';
import HomeCtaSection from '../../features/home/components/HomeCtaSection';
import HowItWorksSection from '../../features/home/components/HowItWorksSection';

import '../../features/home/styles/home.css';

export default function HomePage() {
    return (
        <main className="vox-home-page text-[#243532]">
            <div className="vox-home-background" aria-hidden="true">
                <span className="vox-home-background-glow vox-home-background-glow-one" />
                <span className="vox-home-background-glow vox-home-background-glow-two" />
                <span className="vox-home-background-glow vox-home-background-glow-three" />
                <span className="vox-home-background-grid" />
            </div>

            <div className="vox-home-content">
                <HeroSection />

                <div className="vox-home-sections">
                    <HowItWorksSection />
                    <AboutNexoraSection />
                    <DomainsSection />
                    <FeaturedIdeasSection />
                    <HomeCtaSection />
                </div>
            </div>
        </main>
    );
}