
import React, { useState, useRef, useEffect, createContext, useContext, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import { 
  Play, Pause, PenTool, MessageSquare, Share2, UploadCloud, 
  CheckCircle, X, ChevronRight, LayoutDashboard, Video, 
  MoreVertical, ArrowLeft, Sparkles, Clock, Trash2, Download, 
  LogOut, FileVideo, User as UserIcon, Loader2, Link as LinkIcon
} from 'lucide-react';

/**
 * ============================================================================
 * REAL LIFE DEPLOYMENT GUIDE (FREE TIER / NO CREDIT CARD)
 * 
 * To deploy this for free without a Credit Card:
 * 1. Create a Firebase Project (console.firebase.google.com).
 * 2. Enable "Authentication" -> "Sign-in method" -> Turn on "Anonymous".
 * 3. Enable "Firestore" -> Start in Test Mode.
 * 4. Enable "Storage" -> Start in Test Mode. (This is the Spark Plan - Free).
 * 
 * DO NOT enable "Functions" (Node.js backend) as that requires a billing account.
 * This app is designed to run 100% Client-Side.
 * ============================================================================
 */

const AI_API_KEY = process.env.API_KEY || '';

// --- Types & Schema ---------------------------------------------------------

interface Point { x: number; y: number } // Normalized 0.0 to 1.0
interface Stroke { 
  color: string; 
  width: number; 
  points: Point[] 
}

interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: number; // Video time in seconds
  resolved: boolean;
  drawingData?: Stroke[]; // Vector whiteboard data
  createdAt: number;
}

interface Project {
  id: string;
  publicId: string; // For shareable links
  editorId: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string;
  status: 'processing' | 'ready';
  duration: number;
  createdAt: number;
}

interface User {
  uid: string;
  displayName: string;
  isAnonymous: boolean;
}

// --- Mock Data Store (Simulating Firestore) ---------------------------------

const MOCK_DB = {
  projects: {
    'proj_1': {
      id: 'proj_1',
      publicId: 'review-demo',
      editorId: 'anon_editor',
      title: 'Demo Video (Big Buck Bunny)',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      status: 'ready',
      duration: 596,
      createdAt: Date.now() - 10000000,
    }
  } as Record<string, Project>,
  comments: {
    'proj_1': [
      {
        id: 'c1',
        authorId: 'client_guest',
        authorName: 'Client A',
        text: 'Can we make the grass greener here?',
        timestamp: 5.2,
        resolved: false,
        createdAt: Date.now() - 50000,
        drawingData: [
          { color: '#ef4444', width: 4, points: [{x:0.2, y:0.4}, {x:0.3, y:0.4}, {x:0.3, y:0.5}] }
        ]
      }
    ]
  } as Record<string, Comment[]>
};

// --- Services ---------------------------------------------------------------

const AuthService = {
  // Simulates Firebase Anonymous Auth
  signInAnonymously: async (): Promise<User> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check if we already have a stored session
    const storedUid = localStorage.getItem('cf_uid');
    const uid = storedUid || `user_${Math.random().toString(36).substr(2, 9)}`;
    
    if (!storedUid) localStorage.setItem('cf_uid', uid);

    return {
      uid,
      displayName: 'Editor',
      isAnonymous: true
    };
  },
  
  signOut: async () => {
    // In anonymous mode, "Sign Out" just clears the local session reference in context,
    // but we keep the ID in localStorage so they don't lose their data if they come back.
    return;
  }
};

const StorageService = {
  // Simulates Firebase Storage
  uploadVideo: (file: File, onProgress: (progress: number) => void): Promise<string> => {
    return new Promise((resolve) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        onProgress(progress);
        if (progress >= 100) {
          clearInterval(interval);
          // In a real app without billing, you might strictly rely on Firebase Storage Spark Plan.
          // Since we are mocking here, we return a dummy URL.
          resolve('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4');
        }
      }, 200);
    });
  }
};

const DatabaseService = {
  subscribeToProjects: (userId: string, callback: (projects: Project[]) => void) => {
    const load = () => {
      // In mock mode, we show the demo project to everyone + their own projects
      const projects = Object.values(MOCK_DB.projects).filter(p => p.editorId === userId || p.id === 'proj_1');
      callback(projects);
    };
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  },

  subscribeToComments: (projectId: string, callback: (comments: Comment[]) => void) => {
    const load = () => {
      const comments = MOCK_DB.comments[projectId] || [];
      callback([...comments].sort((a, b) => a.timestamp - b.timestamp));
    };
    load();
    const interval = setInterval(load, 1000);
    return () => clearInterval(interval);
  },

  createProject: async (project: Omit<Project, 'id' | 'publicId' | 'createdAt'>) => {
    const id = `proj_${Date.now()}`;
    const publicId = Math.random().toString(36).substring(7);
    const newProject: Project = {
      ...project,
      id,
      publicId,
      createdAt: Date.now()
    };
    MOCK_DB.projects[id] = newProject;
    MOCK_DB.comments[id] = [];
    return newProject;
  },

  addComment: async (projectId: string, comment: Omit<Comment, 'id' | 'createdAt'>) => {
    const newComment: Comment = {
      ...comment,
      id: `c_${Date.now()}`,
      createdAt: Date.now()
    };
    if (!MOCK_DB.comments[projectId]) MOCK_DB.comments[projectId] = [];
    MOCK_DB.comments[projectId].push(newComment);
    return newComment;
  },

  resolveComment: async (projectId: string, commentId: string, resolved: boolean) => {
    const comments = MOCK_DB.comments[projectId];
    if (comments) {
      const idx = comments.findIndex(c => c.id === commentId);
      if (idx !== -1) comments[idx].resolved = resolved;
    }
  },
  
  getProjectByPublicId: async (publicId: string): Promise<Project | null> => {
    await new Promise(r => setTimeout(r, 500));
    return Object.values(MOCK_DB.projects).find(p => p.publicId === publicId) || null;
  }
};

// --- Gemini AI Service (Client Side) ----------------------------------------

const AIService = {
  summarizeFeedback: async (comments: Comment[], videoTitle: string) => {
    if (!AI_API_KEY) return "Configuration Error: API_KEY is missing.";
    
    const ai = new GoogleGenAI({ apiKey: AI_API_KEY });
    const unresolved = comments.filter(c => !c.resolved);
    
    if (unresolved.length === 0) return "All feedback resolved! Good job.";

    const feedbackData = unresolved.map(c => ({
      time: `${Math.floor(c.timestamp / 60)}:${Math.floor(c.timestamp % 60).toString().padStart(2,'0')}`,
      author: c.authorName,
      text: c.text,
    }));

    const prompt = `
      You are an assistant for a video editor.
      Video Title: "${videoTitle}"
      
      Summarize the following feedback into a checklist.
      Use Markdown.
      
      Feedback:
      ${JSON.stringify(feedbackData)}
    `;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text;
    } catch (e) {
      console.error(e);
      return "Could not generate summary. Check API Key.";
    }
  }
};

// --- React Contexts ---------------------------------------------------------

const AuthContext = createContext<{ user: User | null; login: () => void; logout: () => void }>({
  user: null, login: () => {}, logout: () => {}
});

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  const login = async () => {
    const u = await AuthService.signInAnonymously();
    setUser(u);
  };

  const logout = async () => {
    await AuthService.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// --- Components -------------------------------------------------------------

const Button = ({ children, onClick, variant = 'primary', icon: Icon, disabled, className = '' }: any) => {
  const variants: any = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    secondary: "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    ghost: "text-gray-600 hover:bg-gray-100"
  };
  
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
};

const formatTime = (seconds: number) => {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// --- Whiteboard Canvas Component ---

const WhiteboardOverlay = ({ 
  width, height, isDrawing, drawingData, onDrawEnd, activeCommentDrawing 
}: { 
  width: number, height: number, isDrawing: boolean, 
  drawingData: Stroke[], onDrawEnd: (s: Stroke) => void,
  activeCommentDrawing?: Stroke[]
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  const getNormPoint = (e: React.MouseEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    setCurrentPoints([getNormPoint(e)]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || currentPoints.length === 0) return;
    setCurrentPoints([...currentPoints, getNormPoint(e)]);
  };

  const handleMouseUp = () => {
    if (!isDrawing || currentPoints.length === 0) return;
    onDrawEnd({ color: '#ef4444', width: 4, points: currentPoints });
    setCurrentPoints([]);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawStroke = (stroke: Stroke) => {
      if (stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height);
      }
      ctx.stroke();
    };

    drawingData.forEach(drawStroke);
    if (currentPoints.length > 0) drawStroke({ color: '#ef4444', width: 4, points: currentPoints });
    if (activeCommentDrawing) activeCommentDrawing.forEach(drawStroke);

  }, [width, height, drawingData, currentPoints, activeCommentDrawing]);

  return (
    <canvas 
      ref={canvasRef}
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className={`absolute inset-0 z-20 ${isDrawing ? 'cursor-crosshair' : 'pointer-events-none'}`}
    />
  );
};

// --- Page: Editor Dashboard -------------------------------------------------

const Dashboard = ({ onNavigate }: { onNavigate: (route: any) => void }) => {
  const { user, logout } = useContext(AuthContext);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [manualUrlMode, setManualUrlMode] = useState(false);
  const [manualUrl, setManualUrl] = useState("");

  useEffect(() => {
    if (user) {
      return DatabaseService.subscribeToProjects(user.uid, setProjects);
    }
  }, [user]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setIsUploading(true);
    try {
      const url = await StorageService.uploadVideo(file, setUploadProgress);
      await DatabaseService.createProject({
        editorId: user.uid,
        title: file.name.replace(/\.[^/.]+$/, ""),
        videoUrl: url,
        status: 'ready',
        duration: 0,
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleManualUrlSubmit = async () => {
    if (!manualUrl || !user) return;
    await DatabaseService.createProject({
      editorId: user.uid,
      title: "Linked Video Project",
      videoUrl: manualUrl,
      status: 'ready',
      duration: 0,
    });
    setManualUrlMode(false);
    setManualUrl("");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2 font-bold text-xl text-gray-900">
          <div className="bg-blue-600 text-white p-1.5 rounded-lg">
            <Video size={20} />
          </div>
          CreatorFeedback
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-100 py-1 px-3 rounded-full">
             <UserIcon size={14} /> Anonymous Editor
          </div>
          <Button variant="ghost" onClick={logout} icon={LogOut}>Exit Session</Button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Your Projects</h1>
          
          <div className="flex gap-2">
            {isUploading ? (
              <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm w-64">
                <Loader2 className="animate-spin text-blue-600" size={20} />
                <div className="flex-1">
                  <div className="text-xs text-gray-500 mb-1">Uploading {uploadProgress}%</div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              </div>
            ) : (
              <>
                 <Button variant="secondary" onClick={() => setManualUrlMode(!manualUrlMode)} icon={LinkIcon}>
                   Link URL
                 </Button>
                 <label className="cursor-pointer">
                  <input type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={handleUpload} />
                  <div className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 shadow-sm font-medium transition-colors">
                    <UploadCloud size={18} /> Upload Video
                  </div>
                </label>
              </>
            )}
          </div>
        </div>

        {manualUrlMode && (
          <div className="mb-6 bg-white p-4 rounded-lg border border-blue-100 shadow-sm animate-in fade-in slide-in-from-top-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Paste Public Video URL (MP4)</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="https://example.com/video.mp4"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
              />
              <Button onClick={handleManualUrlSubmit}>Add</Button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Useful for testing if you haven't set up Storage bucket yet.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => (
            <div 
              key={project.id} 
              onClick={() => onNavigate({ page: 'review', projectId: project.id, isEditor: true })}
              className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-all cursor-pointer"
            >
              <div className="aspect-video bg-gray-900 relative flex items-center justify-center">
                <Video className="text-gray-700" size={48} />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                  <Play className="text-white fill-current" size={32} />
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 truncate">{project.title}</h3>
                <div className="flex justify-between items-center mt-3">
                  <span className="text-xs text-gray-500">{new Date(project.createdAt).toLocaleDateString()}</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      alert(`Share Link Copied!\n\nLink: app.com/review/${project.publicId}`);
                    }}
                    className="text-blue-600 hover:bg-blue-50 p-1.5 rounded-full transition-colors"
                  >
                    <Share2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

// --- Page: Review Interface (Public / Editor) -------------------------------

const ReviewPage = ({ projectId, isEditor, onBack }: { projectId: string, isEditor: boolean, onBack: () => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [currentDrawings, setCurrentDrawings] = useState<Stroke[]>([]);
  const [commentText, setCommentText] = useState("");
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);

  useEffect(() => {
    const p = Object.values(MOCK_DB.projects).find(p => p.id === projectId || p.publicId === projectId);
    if (p) setProject(p);
    const pId = p ? p.id : projectId;
    return DatabaseService.subscribeToComments(pId, setComments);
  }, [projectId]);

  const handleTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
      setIsDrawingMode(false);
    }
    setIsPlaying(!isPlaying);
  };

  const seekTo = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !project) return;
    
    await DatabaseService.addComment(project.id, {
      authorId: isEditor ? 'user_1' : 'guest',
      authorName: isEditor ? 'Editor' : 'Guest Client',
      text: commentText,
      timestamp: currentTime,
      resolved: false,
      drawingData: currentDrawings.length > 0 ? currentDrawings : undefined
    });

    setCommentText("");
    setCurrentDrawings([]);
    setIsDrawingMode(false);
  };

  const handleSummarize = async () => {
    if (!project) return;
    setIsThinking(true);
    const summary = await AIService.summarizeFeedback(comments, project.title);
    setAiSummary(summary);
    setIsThinking(false);
  };

  if (!project) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const activeComment = comments.find(c => c.id === activeCommentId);

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white overflow-hidden">
      <header className="h-14 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 shrink-0 z-30 relative">
        <div className="flex items-center gap-4">
          {isEditor && (
            <button onClick={onBack} className="hover:bg-gray-700 p-2 rounded-full">
              <ArrowLeft size={20} />
            </button>
          )}
          <h1 className="font-medium truncate max-w-md">{project.title}</h1>
        </div>
        
        <div className="flex gap-2">
          {isEditor && (
             <Button 
               variant="secondary" 
               className="!bg-purple-600 !text-white !border-0 hover:!bg-purple-700"
               icon={Sparkles}
               onClick={handleSummarize}
               disabled={isThinking}
             >
               {isThinking ? 'Analyzing...' : 'AI Summary'}
             </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col relative bg-black group">
          <div ref={playerContainerRef} className="flex-1 relative flex items-center justify-center overflow-hidden">
             <video 
               ref={videoRef}
               src={project.videoUrl}
               className="max-h-full max-w-full"
               onTimeUpdate={handleTimeUpdate}
               onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
               onEnded={() => setIsPlaying(false)}
               onClick={togglePlay}
             />
             <WhiteboardOverlay
               width={playerContainerRef.current?.clientWidth || 0}
               height={playerContainerRef.current?.clientHeight || 0}
               isDrawing={isDrawingMode}
               drawingData={currentDrawings}
               onDrawEnd={(stroke) => setCurrentDrawings([...currentDrawings, stroke])}
               activeCommentDrawing={activeComment?.drawingData}
             />
             {!isPlaying && !isDrawingMode && (
               <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                 <div className="bg-white/10 backdrop-blur-sm p-6 rounded-full shadow-2xl">
                   <Play fill="white" size={48} />
                 </div>
               </div>
             )}
          </div>

          <div className="bg-gradient-to-t from-gray-900 to-transparent px-4 pb-4 pt-8">
            <div 
              className="relative h-1.5 bg-gray-700 rounded-full mb-4 cursor-pointer group/time"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seekTo(((e.clientX - rect.left) / rect.width) * duration);
              }}
            >
              <div 
                className="absolute h-full bg-blue-500 rounded-full" 
                style={{ width: `${(currentTime / (duration || 1)) * 100}%` }} 
              />
              {comments.map(c => (
                <div 
                  key={c.id}
                  className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-gray-900 transform transition-transform hover:scale-150 ${c.resolved ? 'bg-green-500' : 'bg-yellow-400'}`}
                  style={{ left: `${(c.timestamp / (duration || 1)) * 100}%` }}
                  onClick={(e) => { e.stopPropagation(); seekTo(c.timestamp); setActiveCommentId(c.id); }}
                />
              ))}
            </div>

            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <button onClick={togglePlay} className="text-white hover:text-blue-400">
                  {isPlaying ? <Pause size={24} /> : <Play size={24} fill="currentColor" />}
                </button>
                <span className="font-mono text-sm text-gray-400">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {!isDrawingMode ? (
                  <button 
                    onClick={() => {
                      if (isPlaying) togglePlay();
                      setIsDrawingMode(true);
                      setCurrentDrawings([]);
                      setActiveCommentId(null);
                    }}
                    className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded text-sm border border-gray-600"
                  >
                    <PenTool size={16} /> Draw
                  </button>
                ) : (
                  <div className="flex items-center gap-2 bg-red-900/30 px-3 py-1 rounded border border-red-500/30">
                    <span className="text-xs text-red-200 font-medium uppercase tracking-wider">Drawing Mode</span>
                    <button onClick={() => setIsDrawingMode(false)} className="p-1 hover:bg-red-900/50 rounded-full">
                      <X size={14} className="text-red-200" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="w-96 bg-white border-l border-gray-200 flex flex-col text-gray-900 shadow-xl z-20">
          {aiSummary && (
            <div className="p-4 bg-purple-50 border-b border-purple-100 animate-in slide-in-from-top">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-purple-900 text-sm flex items-center gap-2">
                  <Sparkles size={14} /> AI Feedback Summary
                </h3>
                <button onClick={() => setAiSummary(null)} className="text-purple-400 hover:text-purple-700">
                  <X size={14} />
                </button>
              </div>
              <div className="prose prose-sm text-purple-800 max-h-40 overflow-y-auto text-xs leading-relaxed">
                <div dangerouslySetInnerHTML={{ __html: aiSummary.replace(/\n/g, '<br/>') }} />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {comments.length === 0 && (
              <div className="text-center py-10 text-gray-400">
                <MessageSquare className="mx-auto mb-2 opacity-20" size={48} />
                <p className="text-sm">No comments yet.</p>
                <p className="text-xs">Click timeline to add one.</p>
              </div>
            )}
            {comments.map(comment => (
              <div 
                key={comment.id}
                onClick={() => { seekTo(comment.timestamp); setActiveCommentId(comment.id); }}
                className={`
                  p-3 rounded-lg border transition-all cursor-pointer relative group
                  ${activeCommentId === comment.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-200' : 'bg-white border-gray-100 hover:border-gray-300'}
                  ${comment.resolved ? 'opacity-60' : ''}
                `}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-semibold text-sm text-gray-800">{comment.authorName}</span>
                  <span className="font-mono text-xs text-gray-500 bg-gray-100 px-1.5 rounded">
                    {formatTime(comment.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-gray-600 leading-snug">{comment.text}</p>
                
                {comment.drawingData && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-red-500 font-medium">
                    <PenTool size={10} /> Has Drawing
                  </div>
                )}

                {isEditor && (
                   <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                     <button 
                       onClick={(e) => { e.stopPropagation(); DatabaseService.resolveComment(project.id, comment.id, !comment.resolved); }}
                       className={`p-1 rounded-full ${comment.resolved ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400 hover:bg-green-50 hover:text-green-600'}`}
                     >
                       <CheckCircle size={16} />
                     </button>
                   </div>
                )}
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-gray-200 bg-gray-50">
             {isDrawingMode && (
               <div className="mb-2 px-3 py-2 bg-red-50 border border-red-100 rounded text-xs text-red-700 flex items-center gap-2">
                 <PenTool size={12} /> 
                 <span>Drawing active on frame <b>{formatTime(currentTime)}</b></span>
               </div>
             )}
             <textarea 
               className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
               placeholder={isDrawingMode ? "Add a note about your drawing..." : "Type a comment at current time..."}
               rows={2}
               value={commentText}
               onChange={(e) => setCommentText(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmitComment()}
             />
             <div className="flex justify-between items-center mt-2">
                <div className="text-xs text-gray-400">
                  Timestamp: {formatTime(currentTime)}
                </div>
                <Button 
                  onClick={handleSubmitComment} 
                  disabled={!commentText.trim()}
                  className="!py-1.5 !px-3"
                >
                  Post
                </Button>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main Application Router ------------------------------------------------

const App = () => {
  const { user } = useContext(AuthContext);
  const [route, setRoute] = useState<{ page: 'landing' | 'dashboard' | 'review', projectId?: string, isEditor?: boolean }>({ 
    page: 'landing' 
  });

  const handleLogin = async (loginFn: () => void) => {
    await loginFn();
    setRoute({ page: 'dashboard' });
  };

  let content;
  if (route.page === 'landing') {
    content = (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center text-white p-4">
        <div className="max-w-xl text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-600 rounded-2xl shadow-lg shadow-blue-900/50 mb-8">
            <Video size={40} />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">CreatorFeedback</h1>
          <p className="text-lg text-gray-400 mb-8 leading-relaxed">
            The frictionless video review platform. No signup required.
            Share secure links, get frame-accurate comments, and whiteboard directly on your video.
          </p>
          
          <AuthContext.Consumer>
            {({ login }) => (
              <div className="flex flex-col gap-3 max-w-xs mx-auto">
                <button 
                  onClick={() => handleLogin(login)}
                  className="flex items-center justify-center gap-3 bg-white text-gray-900 font-bold py-3 px-6 rounded-xl hover:bg-gray-100 transition-all shadow-xl"
                >
                  Start Session (No Login)
                </button>
                
                <button 
                   onClick={() => setRoute({ page: 'review', projectId: 'proj_1', isEditor: false })}
                   className="text-sm text-gray-400 hover:text-white mt-4 underline underline-offset-4"
                >
                  Demo: View as Client
                </button>
              </div>
            )}
          </AuthContext.Consumer>
        </div>
      </div>
    );
  } else if (route.page === 'dashboard' && user) {
    content = <Dashboard onNavigate={setRoute} />;
  } else if (route.page === 'review' && route.projectId) {
    content = (
      <ReviewPage 
        projectId={route.projectId} 
        isEditor={!!route.isEditor} 
        onBack={() => setRoute({ page: user ? 'dashboard' : 'landing' })} 
      />
    );
  } else {
    setRoute({ page: 'landing' });
    content = null;
  }

  return content;
};

const root = createRoot(document.getElementById('root')!);
root.render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
