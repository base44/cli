import React from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { Button } from './Button';

interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  description?: string;
  createdAt?: string;
}

interface BookmarkCardProps {
  bookmark: Bookmark;
  onDelete: () => void;
}

export const BookmarkCard: React.FC<BookmarkCardProps> = ({ bookmark, onDelete }) => {
  const handleClick = () => {
    browser.tabs.create({ url: bookmark.url });
  };

  return (
    <div className="group flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-200 hover:shadow-md transition-all duration-200">
      {/* Favicon */}
      {bookmark.favicon ? (
        <img
          src={bookmark.favicon}
          alt=""
          className="w-5 h-5 mt-0.5 rounded"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="w-5 h-5 mt-0.5 bg-slate-200 rounded" />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <button
          onClick={handleClick}
          className="text-left w-full group/link"
        >
          <h3 className="text-sm font-medium text-slate-900 group-hover/link:text-blue-600 transition-colors line-clamp-1">
            {bookmark.title}
          </h3>
          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
            {new URL(bookmark.url).hostname}
          </p>
        </button>
        {bookmark.description && (
          <p className="text-xs text-slate-600 mt-1 line-clamp-2">
            {bookmark.description}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClick}
          className="h-7 w-7 text-slate-400 hover:text-blue-600"
          title="Open in new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
          title="Delete bookmark"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};
