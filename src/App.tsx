import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, Image as ImageIcon, Globe, Cpu, Sparkles, User, Bot, Loader2, Search, Zap, LogOut, LogIn, History, Plus, Trash2, Settings2, X, Upload, Mic, MicOff, Volume2, Stethoscope, GraduationCap, BookOpen, Lightbulb, Brain, Beaker, Code, MapPin, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn, compressImage, cleanFirestoreData } from "./lib/utils";
import { Message, generateChatResponse, ImageParams, Persona } from "./services/gemini";
import { auth, db, autoLogin, logout, OperationType, handleFirestoreError } from "./firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, deleteDoc, getDocs, setDoc } from "firebase/firestore";

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-zinc-100 p-6 text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-4">Something went wrong</h1>
          <p className="text-zinc-400 mb-6 max-w-md">
            An unexpected error occurred. Please try refreshing the page or contact support if the problem persists.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-colors"
          >
            Refresh Page
          </button>
          {process.env.NODE_ENV === 'development' && (
            <pre className="mt-8 p-4 bg-zinc-900 rounded-lg text-xs text-left overflow-auto max-w-full">
              {JSON.stringify(this.state.error, null, 2)}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

function ChatApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [shortcutMode, setShortcutMode] = useState(false);
  const [persona, setPersona] = useState<Persona>("General");
  const [isListening, setIsListening] = useState(false);
  const [showImageSettings, setShowImageSettings] = useState(false);
  const [imageParams, setImageParams] = useState<ImageParams>({
    aspectRatio: "1:1",
    imageSize: "1K",
    style: "Realistic",
  });
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // Voice Recognition Setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = navigator.language || "en-US";

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";
    window.speechSynthesis.speak(utterance);
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        setIsAuthReady(true);
      } else {
        try {
          await autoLogin();
        } catch (error) {
          console.error("Auto login failed:", error);
          setIsAuthReady(true);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Sessions Listener
  useEffect(() => {
    if (!user) {
      setSessions([]);
      setCurrentSessionId(null);
      return;
    }

    const sessionsRef = collection(db, "users", user.uid, "sessions");
    const q = query(sessionsRef, orderBy("createdAt", "desc"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessionData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSessions(sessionData);
      if (sessionData.length > 0 && !currentSessionId) {
        setCurrentSessionId(sessionData[0].id);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sessions`);
    });

    return () => unsubscribe();
  }, [user]);

  const filteredSessions = sessions.filter(session => 
    session.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Messages Listener
  useEffect(() => {
    if (!user || !currentSessionId) {
      setMessages([]);
      return;
    }

    const messagesRef = collection(db, "users", user.uid, "sessions", currentSessionId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messageData = snapshot.docs.map(doc => doc.data() as Message);
      setMessages(messageData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sessions/${currentSessionId}/messages`);
    });

    return () => unsubscribe();
  }, [user, currentSessionId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollAnchorRef.current) {
      scrollAnchorRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  const createNewSession = async () => {
    if (!user) return;
    try {
      const sessionsRef = collection(db, "users", user.uid, "sessions");
      const docRef = await addDoc(sessionsRef, {
        userId: user.uid,
        title: "New Chat",
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
      });
      setCurrentSessionId(docRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/sessions`);
    }
  };

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "sessions", sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(sessions.find(s => s.id !== sessionId)?.id || null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/sessions/${sessionId}`);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string);
        setImageParams(prev => ({ ...prev, referenceImage: compressed }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleChatImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string);
        setUploadedImage(compressed);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && !uploadedImage) || isLoading || !user) return;

    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const sessionsRef = collection(db, "users", user.uid, "sessions");
        const docRef = await addDoc(sessionsRef, {
          userId: user.uid,
          title: input.slice(0, 30) + (input.length > 30 ? "..." : "") || "Image Analysis",
          createdAt: serverTimestamp(),
          lastMessageAt: serverTimestamp(),
        });
        sessionId = docRef.id;
        setCurrentSessionId(sessionId);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/sessions`);
        return;
      }
    }

    const userMessage: Message = {
      role: "user",
      content: input,
      type: uploadedImage ? "image" : "text",
      imageUrl: uploadedImage || undefined,
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    const currentImage = uploadedImage;
    setInput("");
    setUploadedImage(null);
    setIsLoading(true);

    const messagesRef = collection(db, "users", user.uid, "sessions", sessionId, "messages");
    
    try {
      await addDoc(messagesRef, cleanFirestoreData({
        ...userMessage,
        createdAt: serverTimestamp(),
      }));
      
      // Get location if possible
      let location: { latitude: number, longitude: number } | undefined = undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        location = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      } catch (e) {
        console.warn("Location access denied or timed out");
      }

      const response = await generateChatResponse(currentInput, messages, shortcutMode, imageParams, persona, currentImage || undefined, location);
      
      // Compress AI generated image if exists
      if (response.imageUrl) {
        response.imageUrl = await compressImage(response.imageUrl);
      }

      await addDoc(messagesRef, cleanFirestoreData({
        ...response,
        createdAt: serverTimestamp(),
      }));
    } catch (error: any) {
      console.error("Error in chat flow:", error);
      
      const errorMessage: Message = {
        role: "model",
        content: error.message || "⚠️ **Connection Error**: There was a problem connecting to the network. Please check your connection and try again.",
        type: "text",
      };

      setMessages(prev => [...prev, errorMessage]);
      
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/sessions/${sessionId}/messages`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="max-w-md w-full space-y-8"
        >
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center shadow-2xl shadow-indigo-500/20 mb-6">
              <Cpu className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Pavan-Ai</h1>
            <p className="text-zinc-400">Connecting to secure network...</p>
          </div>
          
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl space-y-6">
            <p className="text-sm text-red-400">Connection failed. Please check your network and try again.</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-3 bg-white text-black font-semibold py-3 px-4 rounded-xl hover:bg-zinc-200 transition-all"
            >
              Retry Connection
            </button>
          </div>
          
          <p className="text-xs text-zinc-600 uppercase tracking-widest">
            Secure • Fast • Intelligent
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-72 border-r border-zinc-800 bg-zinc-900/30">
        <div className="p-4 border-b border-zinc-800 space-y-3">
          <button 
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-2.5 px-4 rounded-xl border border-zinc-700 transition-all text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input 
              type="text"
              placeholder="Search history..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950/50 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="px-3 py-2 text-[10px] font-mono text-zinc-600 uppercase tracking-widest flex items-center justify-between">
            <span>Recent Chats</span>
            {searchQuery && <span className="text-indigo-500 lowercase">{filteredSessions.length} found</span>}
          </div>
          {filteredSessions.length > 0 ? (
            filteredSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setCurrentSessionId(session.id)}
                className={cn(
                  "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm transition-all group",
                  currentSessionId === session.id 
                    ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400" 
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                )}
              >
                <div className="flex items-center gap-3 truncate">
                  <History className="w-4 h-4 shrink-0" />
                  <span className="truncate">{session.title}</span>
                </div>
                <Trash2 
                  onClick={(e) => deleteSession(session.id, e)}
                  className="w-4 h-4 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0" 
                />
              </button>
            ))
          ) : (
            <div className="px-3 py-8 text-center">
              <Search className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
              <p className="text-xs text-zinc-600">No chats found matching your search.</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-3 mb-4">
            <img src={user.photoURL || ""} className="w-8 h-8 rounded-full border border-zinc-700" alt="Profile" />
            <div className="flex-1 truncate">
              <div className="text-xs font-semibold truncate">{user.displayName}</div>
              <div className="text-[10px] text-zinc-500 truncate">{user.email}</div>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 text-zinc-500 hover:text-red-400 transition-colors text-xs py-2"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Cpu className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Pavan-Ai</h1>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-widest font-mono">
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Satellite Network Active
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Persona Selector */}
            <div className="hidden lg:flex items-center gap-1 bg-zinc-900/50 border border-zinc-800 rounded-full p-1 mr-2">
              {[
                { id: "General", icon: Sparkles, label: "General" },
                { id: "Doctor", icon: Stethoscope, label: "Doctor" },
                { id: "Learner", icon: GraduationCap, label: "Learner" },
                { id: "Study", icon: BookOpen, label: "Study" },
                { id: "Suggest", icon: Lightbulb, label: "Suggest" },
                { id: "Logic", icon: Brain, label: "Logic" },
                { id: "Scientist", icon: Beaker, label: "Scientist" },
                { id: "Studio", icon: ImageIcon, label: "Studio" },
                { id: "Coder", icon: Code, label: "Coder" },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPersona(p.id as Persona)}
                  className={cn(
                    "p-2 rounded-full transition-all flex items-center gap-2",
                    persona === p.id 
                      ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" 
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                  title={p.label}
                >
                  <p.icon className="w-4 h-4" />
                  {persona === p.id && <span className="text-[10px] font-medium pr-1">{p.label}</span>}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShortcutMode(!shortcutMode)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all text-xs relative overflow-hidden group",
                shortcutMode 
                  ? "bg-amber-500/20 border-amber-500/50 text-amber-400" 
                  : "bg-zinc-800/50 border-zinc-700 text-zinc-400"
              )}
              title="Shortcut Mode: Concise & Ultra-Fast Answers"
            >
              <Zap className={cn("w-3.5 h-3.5", shortcutMode && "fill-amber-400 animate-pulse")} />
              {shortcutMode ? "Ultra-Fast Mode" : "Normal Mode"}
              {shortcutMode && (
                <span className="absolute inset-0 bg-amber-400/10 animate-pulse pointer-events-none" />
              )}
            </button>
            <button
              onClick={() => setShowImageSettings(!showImageSettings)}
              className={cn(
                "p-2 rounded-full border transition-all",
                showImageSettings ? "bg-indigo-500/20 border-indigo-500 text-indigo-400" : "bg-zinc-800/50 border-zinc-700 text-zinc-400"
              )}
              title="Image Generation Settings"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Image Settings Overlay */}
        <AnimatePresence>
          {showImageSettings && (
            <motion.div
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              className="absolute right-0 top-0 bottom-0 w-80 bg-zinc-900 border-l border-zinc-800 z-20 p-6 shadow-2xl overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-indigo-400" />
                  Image Settings
                </h3>
                <button onClick={() => setShowImageSettings(false)} className="text-zinc-500 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Reference Image */}
                <div className="space-y-3">
                  <label className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Reference Image (Same Face)</label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-2xl border-2 border-dashed border-zinc-800 hover:border-indigo-500/50 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 bg-zinc-950/50 overflow-hidden relative group"
                  >
                    {imageParams.referenceImage ? (
                      <>
                        <img src={imageParams.referenceImage} className="w-full h-full object-cover" alt="Reference" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Upload className="w-6 h-6 text-white" />
                        </div>
                      </>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-zinc-700" />
                        <span className="text-[10px] text-zinc-600">Click to upload face</span>
                      </>
                    )}
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                    accept="image/*" 
                    className="hidden" 
                  />
                  {imageParams.referenceImage && (
                    <button 
                      onClick={() => setImageParams(prev => ({ ...prev, referenceImage: undefined }))}
                      className="text-[10px] text-red-400 hover:underline"
                    >
                      Remove reference
                    </button>
                  )}
                </div>

                {/* Aspect Ratio */}
                <div className="space-y-3">
                  <label className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Aspect Ratio</label>
                  <div className="grid grid-cols-3 gap-2">
                    {["1:1", "3:4", "4:3", "9:16", "16:9", "1:4"].map(ratio => (
                      <button
                        key={ratio}
                        onClick={() => setImageParams(prev => ({ ...prev, aspectRatio: ratio as any }))}
                        className={cn(
                          "py-1.5 rounded-lg text-[10px] border transition-all",
                          imageParams.aspectRatio === ratio 
                            ? "bg-indigo-600 border-indigo-500 text-white" 
                            : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
                        )}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Image Size */}
                <div className="space-y-3">
                  <label className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Resolution</label>
                  <div className="grid grid-cols-2 gap-2">
                    {["512px", "1K", "2K", "4K"].map(size => (
                      <button
                        key={size}
                        onClick={() => setImageParams(prev => ({ ...prev, imageSize: size as any }))}
                        className={cn(
                          "py-1.5 rounded-lg text-[10px] border transition-all",
                          imageParams.imageSize === size 
                            ? "bg-indigo-600 border-indigo-500 text-white" 
                            : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
                        )}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Style */}
                <div className="space-y-3">
                  <label className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Style</label>
                  <select 
                    value={imageParams.style}
                    onChange={(e) => setImageParams(prev => ({ ...prev, style: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option>Realistic</option>
                    <option>Cinematic</option>
                    <option>Digital Art</option>
                    <option>Anime</option>
                    <option>Oil Painting</option>
                    <option>3D Render</option>
                    <option>Sketch</option>
                  </select>
                </div>
              </div>

              <div className="mt-8 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl mb-6">
                <p className="text-[10px] text-indigo-300 leading-relaxed">
                  <Zap className="w-3 h-3 inline mr-1" />
                  Tip: Upload a clear face photo to maintain character consistency across multiple generations.
                </p>
              </div>

              <button
                onClick={() => setShowImageSettings(false)}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
              >
                Done
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Area */}
        <main 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 scroll-smooth"
        >
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-6">
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="w-20 h-20 rounded-3xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4"
              >
                <Sparkles className="w-10 h-10 text-indigo-400" />
              </motion.div>
              <h2 className="text-3xl font-bold tracking-tight text-white">How can I help you, {user.displayName?.split(' ')[0]}?</h2>
              <p className="text-zinc-400 leading-relaxed">
                I am Pavan-Ai, your global network assistant with access to **1,000,000+ datasets**. I provide fast, easy-to-understand "shortcut" answers and real-time data from across the web.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full mt-8">
                {[
                  "Generate an image of a futuristic city",
                  "What's the latest news in space exploration?",
                  "Explain quantum physics simply",
                  "Write a creative story about a robot"
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setInput(suggestion);
                      // handleSend will be triggered by the user clicking send
                    }}
                    className="p-4 text-left rounded-2xl bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all text-sm text-zinc-300 group"
                  >
                    {suggestion}
                    <Send className="w-3 h-3 ml-2 inline-block opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className={cn(
                  "flex gap-4 max-w-4xl mx-auto",
                  msg.role === "user" ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1",
                  msg.role === "user" ? "bg-indigo-600" : "bg-zinc-800 border border-zinc-700"
                )}>
                  {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={cn(
                  "flex flex-col gap-2 max-w-[85%]",
                  msg.role === "user" ? "items-end" : "items-start"
                )}>
                  <div className={cn(
                    "p-4 rounded-2xl text-sm leading-relaxed",
                    msg.role === "user" 
                      ? "bg-indigo-600 text-white rounded-tr-none" 
                      : "bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-none"
                  )}>
                    {msg.type === "image" && msg.imageUrl ? (
                      <div className="space-y-4">
                        <img 
                          src={msg.imageUrl} 
                          alt="Generated AI" 
                          className="rounded-xl w-full max-w-md shadow-2xl"
                          referrerPolicy="no-referrer"
                        />
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setUploadedImage(msg.imageUrl!);
                              setPersona("Studio");
                              setInput("Edit this image: ");
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[10px] text-zinc-400 hover:text-white transition-all uppercase tracking-widest font-mono"
                          >
                            <Settings2 className="w-3 h-3" />
                            Studio Edit
                          </button>
                          <a 
                            href={msg.imageUrl} 
                            download="pavan-ai-studio.png"
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[10px] text-zinc-400 hover:text-white transition-all uppercase tracking-widest font-mono"
                          >
                            <Upload className="w-3 h-3 rotate-180" />
                            Export
                          </a>
                        </div>
                        <p>{msg.content}</p>
                      </div>
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none relative group/msg">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                        
                        {/* Grounding Metadata */}
                        {msg.groundingMetadata?.groundingChunks && (
                          <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3">
                            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                              <Globe className="w-3 h-3" />
                              Intelligence Sources
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {msg.groundingMetadata.groundingChunks.map((chunk: any, cIdx: number) => {
                                if (chunk.web) {
                                  return (
                                    <a 
                                      key={cIdx}
                                      href={chunk.web.uri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/50 rounded-lg text-[10px] text-zinc-400 hover:text-white transition-all"
                                    >
                                      <Globe className="w-3 h-3" />
                                      {chunk.web.title || "Source"}
                                      <ExternalLink className="w-2 h-2" />
                                    </a>
                                  );
                                }
                                if (chunk.maps) {
                                  return (
                                    <a 
                                      key={cIdx}
                                      href={chunk.maps.uri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg text-[10px] text-indigo-400 hover:text-indigo-300 transition-all"
                                    >
                                      <MapPin className="w-3 h-3" />
                                      {chunk.maps.title || "View on Maps"}
                                      <ExternalLink className="w-2 h-2" />
                                    </a>
                                  );
                                }
                                return null;
                              })}
                            </div>
                          </div>
                        )}

                        {msg.role === "model" && (
                          <button 
                            onClick={() => speak(msg.content)}
                            className="absolute -right-8 top-0 p-1.5 text-zinc-600 hover:text-indigo-400 opacity-0 group-hover/msg:opacity-100 transition-all"
                            title="Speak Answer"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {msg.groundingMetadata?.searchEntryPoint && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/50 border border-zinc-800 text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                      <Search className="w-3 h-3 text-emerald-500" />
                      Verified Intelligence Source
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-4 max-w-4xl mx-auto"
            >
              <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-zinc-500" />
              </div>
              <div className="flex items-center gap-3 text-zinc-500 text-sm italic">
                <Loader2 className="w-4 h-4 animate-spin" />
                Pavan-Ai is processing global datasets...
              </div>
            </motion.div>
          )}
          <div ref={scrollAnchorRef} className="h-1" />
        </main>

        {/* Input Area */}
        <footer className="p-4 md:p-6 bg-zinc-950 border-t border-zinc-800">
          <div className="max-w-4xl mx-auto relative">
            <AnimatePresence>
              {uploadedImage && (
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 20, opacity: 0 }}
                  className="absolute bottom-full mb-4 left-0 p-2 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex items-center gap-3"
                >
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-zinc-700">
                    <img src={uploadedImage} className="w-full h-full object-cover" alt="Upload Preview" />
                    <button 
                      onClick={() => setUploadedImage(null)}
                      className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/80 rounded-full text-white transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="pr-4 flex flex-col gap-1">
                    <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Image Attached</p>
                    <div className="flex gap-2">
                      {[
                        { label: "Remove BG", prompt: "Remove the background from this image." },
                        { label: "Inpaint", prompt: "Inpaint this image: fill in the missing or selected areas with realistic content." },
                        { label: "Outpaint", prompt: "Outpaint this image: extend the boundaries and fill the new space with matching content." },
                        { label: "Enhance", prompt: "Enhance this image and make it look professional." },
                        { label: "Artistic", prompt: "Apply an artistic filter to this image." },
                      ].map((action) => (
                        <button
                          key={action.label}
                          onClick={() => {
                            setInput(action.prompt);
                            setPersona("Studio");
                          }}
                          className="text-[9px] px-2 py-1 bg-zinc-800 hover:bg-indigo-600/30 border border-zinc-700 hover:border-indigo-500/50 rounded-md text-zinc-400 hover:text-indigo-300 transition-all uppercase tracking-tighter"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask Pavan-Ai anything..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 pr-32 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all resize-none text-sm min-h-[60px] max-h-[200px]"
              rows={1}
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-1">
              <input 
                type="file" 
                ref={chatFileInputRef} 
                onChange={handleChatImageUpload} 
                accept="image/*" 
                className="hidden" 
              />
              <button 
                onClick={() => chatFileInputRef.current?.click()}
                className="p-2 text-zinc-500 hover:text-indigo-400 transition-colors"
                title="Upload Image"
              >
                <Upload className="w-5 h-5" />
              </button>
              <button 
                onClick={toggleListening}
                className={cn(
                  "p-2 transition-all",
                  isListening ? "text-red-500 animate-pulse" : "text-zinc-500 hover:text-indigo-400"
                )}
                title="Voice Command"
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button 
                onClick={() => setInput(prev => prev + " Generate an image of ")}
                className="p-2 text-zinc-500 hover:text-indigo-400 transition-colors"
                title="Generate Image"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl transition-all shadow-lg shadow-indigo-500/20"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
          <p className="text-center text-[10px] text-zinc-600 mt-4 uppercase tracking-[0.2em]">
            Powered by Global Satellite Intelligence & Google AI
          </p>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ChatApp />
    </ErrorBoundary>
  );
}
