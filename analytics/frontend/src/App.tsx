import { Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { ChatHistoryPage } from './pages/ChatHistoryPage';
import { UserUsagePage } from './pages/UserUsagePage';
import { MonitoringPage } from './pages/MonitoringPage';
import { CommentsPage } from './pages/CommentsPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { Layout } from './components/Layout';

const App = () => {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/chat-history" element={<ChatHistoryPage />} />
        <Route path="/user-usage" element={<UserUsagePage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/comments" element={<CommentsPage />} />
        <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
        <Route path="/users/:userId" element={<UserDetailPage />} />
      </Routes>
    </Layout>
  );
};

export default App;
