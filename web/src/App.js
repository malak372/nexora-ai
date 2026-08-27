/**
 * Root application component.
 *
 * @author Eman
 */

import AppRoutes from './routes/AppRoutes';
import { UserExperienceLayer, UserExperienceProvider } from './system/user-experience';

function App() {
  return (
    <UserExperienceProvider>
      <AppRoutes />
      <UserExperienceLayer />
    </UserExperienceProvider>
  );
}

export default App;