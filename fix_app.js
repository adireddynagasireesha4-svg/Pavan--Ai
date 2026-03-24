const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf8');

let newContent = content.replace(/import \{ auth, db, enterApp, logout, OperationType, handleFirestoreError \} from "\.\/firebase";/g, '');
newContent = newContent.replace(/import \{ onAuthStateChanged, User as FirebaseUser \} from "firebase\/auth";/g, '');
newContent = newContent.replace(/import \{ collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, deleteDoc, getDocs, setDoc \} from "firebase\/firestore";/g, '');

// Save changes back
fs.writeFileSync('src/App.tsx.new', newContent);
