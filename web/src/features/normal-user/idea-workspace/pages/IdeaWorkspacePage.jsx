import { ArrowLeft, BriefcaseBusiness, CalendarDays, CheckCircle2, Globe2, LockKeyhole, Rocket, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getIdeaOutputs, getIdeaWorkspace } from '../api/ideaWorkspaceApi';
import '../styles/idea-workspace.css';

const text = (value) => Array.isArray(value) ? value.join('\n') : value || 'Not available yet.';

export default function IdeaWorkspacePage() {
    const { ideaId } = useParams();
    const navigate = useNavigate();
    const [idea, setIdea] = useState(null);
    const [outputs, setOutputs] = useState([]);
    const [activeKey, setActiveKey] = useState('overview');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const loadedIdea = await getIdeaWorkspace(ideaId);
                const loadedOutputs = loadedIdea?.isUnlocked ? await getIdeaOutputs(ideaId) : [];
                if (mounted) { setIdea(loadedIdea); setOutputs(loadedOutputs); }
            } catch (requestError) {
                if (mounted) setError(requestError.message);
            } finally { if (mounted) setLoading(false); }
        })();
        return () => { mounted = false; };
    }, [ideaId]);

    if (loading) return <section className="workspace-state">Loading your idea workspace…</section>;
    if (error || !idea) return <section className="workspace-state"><h1>Idea unavailable</h1><p>{error}</p><button onClick={() => navigate('/normal/ideas')}>Back to My ideas</button></section>;

    const sections = [
        { key: 'overview', title: 'Overview', content: idea.fullAbstract || idea.partialAbstract || idea.limitedAbstract },
        { key: 'problem', title: 'Problem', content: idea.problemStatement },
        { key: 'objectives', title: 'Objectives', content: idea.objectives },
        { key: 'users', title: 'Target users', content: idea.targetUsers },
        ...outputs.map((output) => ({ key: output.outputKey, title: output.title, content: output.content || output.structuredContent })),
    ];
    const current = sections.find((item) => item.key === activeKey) ?? sections[0];

    return <main className="idea-workspace">
        <button className="workspace-back" onClick={() => navigate('/normal/ideas')}><ArrowLeft size={17} /> My ideas</button>
        <section className="workspace-hero">
            <div><span className="workspace-eyebrow"><Sparkles size={14} /> PRIVATE IDEA WORKSPACE</span><h1>{idea.title}</h1><p>{idea.domain?.name || 'General innovation'} · {idea.selectedRegion || 'Global scope'}</p></div>
            <div className="workspace-actions">
                {!idea.isUnlocked && <button className="workspace-primary" onClick={() => navigate(`/normal/ideas/${ideaId}/unlock`)}><LockKeyhole size={17} /> Direct unlock</button>}
                {idea.isUnlocked && <button onClick={() => navigate(`/normal/ideas/${ideaId}/business-model`)}><BriefcaseBusiness size={17} /> Business model</button>}
                <button onClick={() => navigate(`/normal/ideas/${ideaId}/publish`)}><Globe2 size={17} /> {idea.publication?.status === 'PUBLISHED' ? 'Manage publication' : 'Publish idea'}</button>
            </div>
        </section>

        <section className="workspace-summary-grid">
            <article><Rocket /><strong>{idea.generationType || 'AI generated'}</strong><span>Generation type</span></article>
            <article><CheckCircle2 /><strong>{idea.isUnlocked ? 'Unlocked' : 'Core access'}</strong><span>Workspace access</span></article>
            <article><CalendarDays /><strong>{new Date(idea.createdAt).toLocaleDateString()}</strong><span>Created</span></article>
        </section>

        <section className="workspace-body">
            <aside>{sections.map((section) => <button key={section.key} className={activeKey === section.key ? 'is-active' : ''} onClick={() => setActiveKey(section.key)}>{section.title}</button>)}</aside>
            <article className="workspace-document"><span>IDEA DOCUMENT</span><h2>{current.title}</h2><div className="workspace-copy">{typeof current.content === 'object' ? <pre>{JSON.stringify(current.content, null, 2)}</pre> : text(current.content).split('\n').map((line, index) => <p key={index}>{line}</p>)}</div></article>
        </section>
    </main>;
}