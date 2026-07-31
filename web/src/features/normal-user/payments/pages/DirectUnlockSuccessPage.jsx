import { CheckCircle2 } from 'lucide-react';
 import { useNavigate, useParams } from 'react-router-dom'; 
 import '../styles/direct-unlock.css'; 
 export default function DirectUnlockSuccessPage() { const { ideaId } = useParams(); const navigate = useNavigate(); return <main className="unlock-result"><CheckCircle2 /><h1>Payment received for verification</h1><p>Your provider redirected you successfully. Nexora will unlock the idea after the verified payment webhook is processed.</p><button onClick={() => navigate(`/normal/ideas/${ideaId}`)}>Return to idea workspace</button></main> }