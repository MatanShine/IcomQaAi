import { useParams } from 'react-router-dom';

export const UserDetailPage = () => {
  const { userId } = useParams();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">User {userId}</h1>
      <p className="text-slate-600 dark:text-slate-400">Session analytics will appear here.</p>
    </div>
  );
};