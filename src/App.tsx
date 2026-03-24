import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from "react";
import { Send, Image as ImageIcon, Globe, User, Bot, Loader2, Search, Zap, LogOut, Plus, Trash2, Settings2, X, Upload, Mic, MicOff, Volume2, Paperclip, MoreVertical, MessageSquare, Check, CheckCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn, compressImage, cleanFirestoreData } from "./lib/utils";
import { Message, generateChatResponse, ImageParams, Persona } from "./services/gemini";
import { auth, db, signInAnonymously, logout, OperationType, handleFirestoreError } from "./firebase";
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
        <div className="flex flex-col items-center justify-center h-screen bg-[#f0f2f5] text-gray-800 p-6 text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-4">Something went wrong</h1>
          <p className="text-gray-600 mb-6 max-w-md">
            An unexpected error occurred. Please try refreshing the page.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-[#00a884] text-white rounded-xl hover:bg-[#008f6f] transition-colors"
          >
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function WhatsAppChat() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
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
        content: "⚠️ **Connection Error**: I'm having trouble connecting to my network. Please try again.",
        type: "text",
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="h-screen bg-[#efeae2] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-[#00a884] animate-spin" />
      </div>
    );
  }

  const formatTime = () => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex h-screen bg-[#eae6df] text-[#111b21] font-sans overflow-hidden">
      <div className="flex w-full max-w-[1600px] mx-auto bg-white shadow-xl h-full">
        {/* Left Sidebar */}
        <aside className="w-[30%] min-w-[300px] border-r border-[#d1d7db] flex flex-col bg-white">
          {/* Sidebar Header */}
          <div className="bg-[#f0f2f5] h-[60px] px-4 flex items-center justify-between shrink-0">
            <div className="w-10 h-10 rounded-full bg-gray-300 overflow-hidden">
              <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=${user?.uid || 'guest'}`} alt="Profile" className="w-full h-full object-cover" />
            </div>
            <div className="flex items-center gap-4 text-[#54656f]">
              <button onClick={createNewSession} title="New Chat" className="hover:bg-gray-200 p-2 rounded-full transition-colors">
                <MessageSquare className="w-5 h-5" />
              </button>
              <button onClick={logout} title="Logout" className="hover:bg-gray-200 p-2 rounded-full transition-colors">
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="bg-white p-2 border-b border-[#f0f2f5]">
            <div className="bg-[#f0f2f5] rounded-lg flex items-center px-3 py-1.5 h-[35px]">
              <Search className="w-4 h-4 text-[#54656f] mr-4" />
              <input 
                type="text"
                placeholder="Search or start new chat"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent focus:outline-none text-sm placeholder:text-[#54656f]"
              />
            </div>
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto bg-white">
            {filteredSessions.map((session) => (
              <div
                key={session.id}
                onClick={() => setCurrentSessionId(session.id)}
                className={cn(
                  "flex items-center px-3 py-3 hover:bg-[#f5f6f6] cursor-pointer transition-colors group relative",
                  currentSessionId === session.id && "bg-[#f0f2f5]"
                )}
              >
                <div className="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center shrink-0 mr-3 text-white font-bold">
                  AI
                </div>
                <div className="flex-1 border-b border-[#f0f2f5] pb-3 pt-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-medium text-[#111b21] truncate pr-2">{session.title}</span>
                    <span className="text-xs text-[#54656f] shrink-0">{formatTime()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[#54656f] truncate w-[80%]">
                      {session.id === currentSessionId && messages.length > 0 
                        ? (messages[messages.length - 1].content.slice(0, 30) + '...') 
                        : 'Tap to view chat'}
                    </span>
                    <button 
                      onClick={(e) => deleteSession(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-[#54656f] hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main Chat Area */}
        {currentSessionId ? (
          <main className="flex-1 flex flex-col bg-[#efeae2] relative overflow-hidden">
            {/* WhatsApp Background Pattern */}
            <div className="absolute inset-0 opacity-[0.06] pointer-events-none" 
                 style={{backgroundImage: 'url("https://static.whatsapp.net/rsrc.php/v3/yl/r/rro_yqP4xW9.png")', backgroundRepeat: 'repeat'}}>
            </div>

            {/* Chat Header */}
            <header className="bg-[#f0f2f5] h-[60px] px-4 flex items-center justify-between shrink-0 z-10">
              <div className="flex items-center gap-3 cursor-pointer">
                <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center text-white font-bold">
                  AI
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-[#111b21]">WhatsApp AI Agent</span>
                  <span className="text-xs text-[#54656f]">online</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[#54656f]">
                <Search className="w-5 h-5 cursor-pointer" />
                <MoreVertical className="w-5 h-5 cursor-pointer" />
              </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-2 z-10 relative">
              <div className="flex justify-center mb-4">
                <span className="bg-[#ffeecd] text-[#54656f] text-xs px-3 py-1 rounded-lg shadow-sm">
                  Messages are secured and powered by Gemini 2.5 Flash.
                </span>
              </div>

              {messages.map((msg, idx) => {
                const isUser = msg.role === "user";
                return (
                  <div key={idx} className={cn("flex w-full mb-1", isUser ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[65%] px-3 py-2 rounded-lg relative text-sm shadow-sm",
                      isUser ? "bg-[#d9fdd3] rounded-tr-none" : "bg-white rounded-tl-none"
                    )}>
                      {msg.type === "image" && msg.imageUrl && (
                        <div className="mb-2">
                          <img 
                            src={msg.imageUrl} 
                            alt="Attached" 
                            className="rounded-lg max-w-full h-auto cursor-pointer"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                      
                      <div className="prose prose-sm max-w-none text-[#111b21] break-words whatsapp-markdown">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      
                      <div className="flex items-center justify-end gap-1 mt-1 -mr-1">
                        <span className="text-[10px] text-[#667781] leading-none">{formatTime()}</span>
                        {isUser && <CheckCheck className="w-[14px] h-[14px] text-[#53bdeb]" />}
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {isLoading && (
                <div className="flex w-full mb-1 justify-start">
                  <div className="max-w-[65%] px-4 py-3 bg-white rounded-lg rounded-tl-none shadow-sm flex items-center gap-2 text-sm text-[#54656f]">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-[#8696a0] rounded-full animate-bounce" style={{animationDelay: '0ms'}} />
                      <div className="w-2 h-2 bg-[#8696a0] rounded-full animate-bounce" style={{animationDelay: '150ms'}} />
                      <div className="w-2 h-2 bg-[#8696a0] rounded-full animate-bounce" style={{animationDelay: '300ms'}} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={scrollAnchorRef} className="h-4" />
            </div>

            {/* Input Area */}
            <footer className="bg-[#f0f2f5] px-4 py-3 shrink-0 z-10 relative">
              {uploadedImage && (
                <div className="absolute bottom-full left-0 right-0 bg-[#f0f2f5] p-3 border-b border-[#d1d7db] flex items-center">
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#d1d7db]">
                    <img src={uploadedImage} className="w-full h-full object-cover" alt="Upload Preview" />
                    <button 
                      onClick={() => setUploadedImage(null)}
                      className="absolute top-1 right-1 p-0.5 bg-black/50 hover:bg-black/80 rounded-full text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 max-w-5xl mx-auto">
                <input 
                  type="file" 
                  ref={chatFileInputRef} 
                  onChange={handleChatImageUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
                <button 
                  onClick={() => chatFileInputRef.current?.click()}
                  className="p-2 text-[#54656f] hover:text-[#111b21] transition-colors"
                >
                  <Paperclip className="w-6 h-6" />
                </button>
                
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a message"
                  className="flex-1 bg-white border-none rounded-lg px-4 py-2.5 focus:outline-none text-[#111b21] text-sm"
                />
                
                {input.trim() || uploadedImage ? (
                  <button
                    onClick={handleSend}
                    disabled={isLoading}
                    className="p-2 text-[#54656f] hover:text-[#111b21] transition-colors disabled:opacity-50"
                  >
                    <Send className="w-6 h-6" />
                  </button>
                ) : (
                  <button className="p-2 text-[#54656f] hover:text-[#111b21] transition-colors">
                    <Mic className="w-6 h-6" />
                  </button>
                )}
              </div>
            </footer>
          </main>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] border-l border-[#d1d7db]">
            <div className="w-[300px] mb-8">
              <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/w3/svg">
                <circle cx="50" cy="50" r="45" fill="#00a884" />
                <path d="M50 20 L50 45 L70 65" stroke="white" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>
            <h1 className="text-3xl font-light text-[#41525d] mb-4">WhatsApp Web UI</h1>
            <p className="text-[#667781] text-center max-w-[400px]">
              Send and receive messages without keeping your phone online.<br/>
              Use WhatsApp AI Agent on up to 4 linked devices and 1 phone at the same time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WhatsAppChat />
    </ErrorBoundary>
  );
}
