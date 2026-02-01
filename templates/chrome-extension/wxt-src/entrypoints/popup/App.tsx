import { useState, useEffect } from 'react';
import { base44 } from '@/lib/base44Client';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { BookmarkCard } from '@/components/BookmarkCard';
import { Bookmark, Plus, Search, Sparkles } from 'lucide-react';

const BookmarkEntity = base44.entities.Bookmark;

interface CurrentTab {
  url?: string;
  title?: string;
  favicon?: string;
}

export default function App() {
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentTab, setCurrentTab] = useState<CurrentTab>({});
  const [isAISearch, setIsAISearch] = useState(false);

  useEffect(() => {
    fetchBookmarks();
    getCurrentTab();
  }, []);

  const getCurrentTab = async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: 'GET_CURRENT_TAB' });
      setCurrentTab(response);
    } catch (error) {
      console.error('Error getting current tab:', error);
    }
  };

  const fetchBookmarks = async () => {
    try {
      const data = await BookmarkEntity.list();
      setBookmarks(data);
    } catch (error) {
      console.error('Error fetching bookmarks:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveCurrentPage = async () => {
    if (!currentTab.url || !currentTab.title) return;

    setIsSaving(true);
    try {
      await BookmarkEntity.create({
        url: currentTab.url,
        title: currentTab.title,
        favicon: currentTab.favicon || '',
        tags: [],
      });
      await fetchBookmarks();
    } catch (error) {
      console.error('Error saving bookmark:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteBookmark = async (id: string) => {
    try {
      await BookmarkEntity.delete(id);
      await fetchBookmarks();
    } catch (error) {
      console.error('Error deleting bookmark:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      fetchBookmarks();
      return;
    }

    if (isAISearch) {
      // Use AI agent for natural language search
      try {
        const agent = base44.agents.BookmarkSearchAgent;
        const response = await agent.run(searchQuery);
        // Parse agent response and filter bookmarks
        // This is a placeholder - actual implementation depends on agent response format
        console.log('AI Search result:', response);
      } catch (error) {
        console.error('Error with AI search:', error);
      }
    } else {
      // Simple text search
      const filtered = bookmarks.filter((bookmark) =>
        bookmark.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        bookmark.url.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setBookmarks(filtered);
    }
  };

  const filteredBookmarks = searchQuery
    ? bookmarks.filter((bookmark) =>
        bookmark.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        bookmark.url.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : bookmarks;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      <div className="w-full h-full">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Bookmark className="w-5 h-5 text-blue-600" />
              My Bookmarks
            </h1>
            <Button
              onClick={saveCurrentPage}
              disabled={isSaving || !currentTab.url}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-1" />
              Save Page
            </Button>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search bookmarks..."
              className="pl-9 pr-10"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <button
              onClick={() => setIsAISearch(!isAISearch)}
              className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors ${
                isAISearch ? 'text-purple-600 bg-purple-50' : 'text-slate-400 hover:text-slate-600'
              }`}
              title="Toggle AI Search"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Bookmarks List */}
        <div className="p-4 space-y-2 max-h-[440px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
            </div>
          ) : filteredBookmarks.length === 0 ? (
            <div className="text-center py-12">
              <Bookmark className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">
                {searchQuery ? 'No bookmarks found' : 'No bookmarks yet'}
              </p>
              {!searchQuery && (
                <p className="text-slate-400 text-xs mt-1">
                  Click "Save Page" to bookmark this page
                </p>
              )}
            </div>
          ) : (
            filteredBookmarks.map((bookmark) => (
              <BookmarkCard
                key={bookmark.id}
                bookmark={bookmark}
                onDelete={() => deleteBookmark(bookmark.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
