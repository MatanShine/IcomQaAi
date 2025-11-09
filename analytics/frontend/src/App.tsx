import { Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { SupportRequestsPage } from './pages/SupportRequestsPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { Layout } from './components/Layout';

const App = () => {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/support-requests" element={<SupportRequestsPage />} />
        <Route path="/users/:userId" element={<UserDetailPage />} />
      </Routes>
    </Layout>
  );
};

export default App;
