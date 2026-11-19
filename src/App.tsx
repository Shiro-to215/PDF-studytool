import { useEffect } from 'react';
import { useThemeStore } from './stores/useThemeStore';
import { useViewerStore } from './stores/useViewerStore';
import { HomePage } from './pages/HomePage';
import { StudyPage } from './pages/StudyPage';

export function App() {
  const initTheme = useThemeStore((s) => s.initTheme);
  const activeWorkbookId = useViewerStore((s) => s.activeWorkbookId);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  if (activeWorkbookId) {
    return <StudyPage workbookId={activeWorkbookId} />;
  }

  return <HomePage />;
}

export default App;
