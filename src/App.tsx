import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from "react";
import { Send, Loader2, Search, Trash2, X, Paperclip, MessageSquare, Menu, Lock, Plus, LogOut, ShieldCheck, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn, compressImage, cleanFirestoreData } from "./lib/utils";
import { Message, generateChatResponse } from "./services/gemini";
import { auth, db, signInAnonymously, logout, OperationType, handleFirestoreError } from "./firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, deleteDoc } from "firebase/firestore";

// Error Boundary
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
          <h1 className="text-2xl font-bold text-red-500 mb-4">System Error</h1>
          <p className="text-zinc-400 mb-6 max-w-md">An unexpected error occurred in Pavan AI.</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Reboot System
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppLock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<'setup' | 'confirm' | 'login'>('login');
  const [tempPin, setTempPin] = useState("");
  
  useEffect(() => {
    const savedPin = localStorage.getItem('pavan_ai_pin');
    if (!savedPin) {
      setMode('setup');
    }
  }, []);

  const handleKeypad = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      setError(false);
      
      if (newPin.length === 4) {
        setTimeout(() => processPin(newPin), 100);
      }
    }
  };

  const processPin = (currentPin: string) => {
    if (mode === 'setup') {
      setTempPin(currentPin);
      setPin("");
      setMode('confirm');
    } else if (mode === 'confirm') {
      if (currentPin === tempPin) {
        localStorage.setItem('pavan_ai_pin', currentPin);
        onUnlock();
      } else {
        setError(true);
        setPin("");
        setTempPin("");
        setMode('setup');
        setTimeout(() => setError(false), 500);
      }
    } else if (mode === 'login') {
      const savedPin = localStorage.getItem('pavan_ai_pin');
      if (currentPin === savedPin) {
        onUnlock();
      } else {
        setError(true);
        setPin("");
        setTimeout(() => setError(false), 500);
      }
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setError(false);
  };

  const getTitle = () => {
    if (mode === 'setup') return "Set up Access PIN";
    if (mode === 'confirm') return "Confirm Access PIN";
    return "Enter Access PIN";
  };

  const getSubtitle = () => {
    if (mode === 'setup') return "Create a 4-digit PIN to secure your data.";
    if (mode === 'confirm') return "Please re-enter your PIN to confirm.";
    return "Enter your 4-digit PIN to access Pavan AI.";
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-zinc-100 p-6 select-none">
      <div className="flex flex-col items-center max-w-sm w-full">
        <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mb-6">
          <ShieldCheck className="w-8 h-8 text-indigo-500" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{getTitle()}</h1>
        <p className="text-zinc-400 text-center mb-10 h-10">{error ? <span className="text-red-400">PIN mismatch or incorrect. Try again.</span> : getSubtitle()}</p>
        
        <div className={cn("flex gap-4 mb-12", error && "shake")}>
          {[0, 1, 2, 3].map(i => (
            <div 
              key={i} 
              className={cn(
                "w-4 h-4 rounded-full border-2 transition-colors duration-200",
                pin.length > i ? "bg-indigo-500 border-indigo-500" : "border-zinc-700 bg-transparent"
              )}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-6 w-full max-w-[280px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleKeypad(num.toString())}
              className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center text-2xl font-semibold hover:bg-zinc-800 active:bg-zinc-700 transition-colors focus:outline-none"
            >
              {num}
            </button>
          ))}
          <div className="w-20 h-20"></div>
          <button
            onClick={() => handleKeypad("0")}
            className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center text-2xl font-semibold hover:bg-zinc-800 active:bg-zinc-700 transition-colors focus:outline-none"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="w-20 h-20 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-100 active:bg-zinc-800 transition-colors focus:outline-none"
          >
            <ChevronRight className="w-8 h-8 rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PavanAIChat() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Auto Login Anonymously
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setIsAuthReady(true);
      } else {
        try {
          await signInAnonymously();
        } catch (error) {
          console.error("Auto login failed", error);
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

  // Auto-scroll
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
        title: "New Session",
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
      });
      setCurrentSessionId(docRef.id);
      setSidebarOpen(false);
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
      
      const response = await generateChatResponse(currentInput, messages, false, undefined, "General", currentImage || undefined);
      
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
        content: "⚠️ **System Offline**: Unable to reach intelligence network.",
        type: "text",
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden transition-opacity" 
          onClick={() => setSidebarOpen(false)} 
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 flex items-center justify-between border-b border-zinc-800">
          <div className="flex items-center gap-2 font-bold text-lg text-indigo-400">
            <ShieldCheck className="w-6 h-6" />
            <span>Pavan AI</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden p-1 text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 border-b border-zinc-800">
          <button 
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 px-4 rounded-lg transition-colors font-medium"
          >
            <Plus className="w-4 h-4" /> New Session
          </button>
        </div>

        <div className="p-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input 
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-indigo-500 text-zinc-200 placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredSessions.map((session) => (
            <div
              key={session.id}
              onClick={() => {
                setCurrentSessionId(session.id);
                setSidebarOpen(false);
              }}
              className={cn(
                "group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors",
                currentSessionId === session.id ? "bg-zinc-800 text-indigo-300" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              )}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare className="w-4 h-4 shrink-0" />
                <span className="truncate text-sm font-medium">{session.title}</span>
              </div>
              <button 
                onClick={(e) => deleteSession(session.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 flex items-center justify-between text-sm text-zinc-400">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            System Online
          </div>
          <button onClick={() => { localStorage.removeItem('pavan_ai_pin'); window.location.reload(); }} title="Lock System" className="hover:text-white">
            <Lock className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950 relative">
        {/* Mobile Header */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-zinc-800 md:hidden bg-zinc-900 z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="p-1 -ml-1 text-zinc-400 hover:text-white">
              <Menu className="w-6 h-6" />
            </button>
            <span className="font-semibold text-zinc-100">Pavan AI</span>
          </div>
          <div className="flex items-center">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
          </div>
        </header>

        {currentSessionId ? (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-4">
                  <ShieldCheck className="w-16 h-16 text-indigo-500/20" />
                  <p className="text-lg">Secure Session Initialized</p>
                </div>
              )}
              
              {messages.map((msg, idx) => {
                const isUser = msg.role === "user";
                return (
                  <div key={idx} className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[85%] md:max-w-[70%] px-4 py-3 rounded-2xl text-sm md:text-base",
                      isUser ? "bg-indigo-600 text-white rounded-tr-sm" : "bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-sm"
                    )}>
                      {msg.type === "image" && msg.imageUrl && (
                        <div className="mb-3">
                          <img 
                            src={msg.imageUrl} 
                            alt="Attached content" 
                            className="rounded-lg max-w-full h-auto object-contain bg-zinc-950/50"
                          />
                        </div>
                      )}
                      
                      <div className={cn("prose prose-sm md:prose-base max-w-none break-words", isUser ? "text-white prose-invert" : "dark-markdown")}>
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {isLoading && (
                <div className="flex w-full justify-start">
                  <div className="px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-sm flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                    <span className="text-sm text-zinc-400">Processing...</span>
                  </div>
                </div>
              )}
              <div ref={scrollAnchorRef} className="h-2" />
            </div>

            {/* Input Footer */}
            <div className="p-4 bg-zinc-950/80 backdrop-blur-sm border-t border-zinc-800">
              <div className="max-w-4xl mx-auto relative">
                {uploadedImage && (
                  <div className="absolute bottom-full left-0 mb-4 p-2 bg-zinc-900 border border-zinc-800 rounded-lg shadow-lg">
                    <div className="relative w-20 h-20 rounded-md overflow-hidden bg-zinc-950">
                      <img src={uploadedImage} className="w-full h-full object-cover" alt="Upload" />
                      <button 
                        onClick={() => setUploadedImage(null)}
                        className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-black/90 rounded-full text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-700 focus-within:border-indigo-500 rounded-2xl p-2 transition-colors">
                  <input 
                    type="file" 
                    ref={chatFileInputRef} 
                    onChange={handleImageUpload} 
                    accept="image/*" 
                    className="hidden" 
                  />
                  <button 
                    onClick={() => chatFileInputRef.current?.click()}
                    className="p-2.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-xl transition-colors shrink-0"
                    title="Attach Image"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  
                  <textarea
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Message Pavan AI..."
                    className="flex-1 bg-transparent border-none px-2 py-2.5 max-h-[120px] focus:outline-none text-zinc-100 placeholder:text-zinc-500 resize-none min-h-[44px]"
                    rows={1}
                  />
                  
                  <button
                    onClick={handleSend}
                    disabled={isLoading || (!input.trim() && !uploadedImage)}
                    className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors shrink-0 disabled:opacity-50 disabled:hover:bg-indigo-600"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
                <div className="text-center mt-2">
                  <span className="text-[10px] text-zinc-600">Pavan AI uses advanced encryption. Data is securely processed.</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-20 h-20 bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-6 border border-indigo-500/20">
              <ShieldCheck className="w-10 h-10 text-indigo-500" />
            </div>
            <h1 className="text-3xl font-bold text-zinc-100 mb-3">Pavan AI</h1>
            <p className="text-zinc-400 max-w-md mb-8">
              Advanced secure intelligence network. Select a session from the sidebar or start a new secure chat to begin.
            </p>
            <button 
              onClick={createNewSession}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-6 rounded-xl transition-colors font-medium shadow-lg shadow-indigo-500/20"
            >
              <Plus className="w-5 h-5" /> Initialize Session
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);

  return (
    <ErrorBoundary>
      {!unlocked ? (
        <AppLock onUnlock={() => setUnlocked(true)} />
      ) : (
        <PavanAIChat />
      )}
    </ErrorBoundary>
  );
}