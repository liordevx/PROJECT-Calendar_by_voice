import React, { useState, useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import { 
  Mic, 
  MicOff, 
  Calendar as CalendarIcon, 
  Loader2, 
  Plus, 
  Trash2, 
  Download,
  Globe, 
  Sparkles, 
  Volume2, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  X,
  Cloud,
  Server
} from 'lucide-react';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const EXAMPLE_PROMPTS = {
  'he-IL': [
    'פגישה מחר בשעה 3',
    'תור לרופא ביום שני הבא ב-10 בבוקר',
    'קבע שיחת צוות היום ב-5'
  ],
  'en-US': [
    'Meeting tomorrow at 3 PM',
    'Doctor appointment next Monday at 10 AM',
    'Team sync today at 5 PM'
  ]
};

export default function App() {
  const [events, setEvents] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('idle'); // idle, listening, processing, error
  const [errorMsg, setErrorMsg] = useState('');
  const [language, setLanguage] = useState('he-IL');
  const [notification, setNotification] = useState(null); // { type: 'success'|'error', text: '' }
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [llmOutput, setLlmOutput] = useState('');
  const [llmMode, setLlmMode] = useState('cloud'); // 'cloud' | 'local'
  const [sttMode, setSttMode] = useState('server'); // 'server' | 'local'

  // Manual event form state
  const [manualTitle, setManualTitle] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualTime, setManualTime] = useState('10:00');

  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const calendarRef = useRef(null);

  // Auto-clear notification
  const showToast = (text, type = 'success') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Load events on mount
  useEffect(() => {
    const savedEvents = localStorage.getItem('voice-calendar-events');
    if (savedEvents) {
      try {
        setEvents(JSON.parse(savedEvents));
      } catch (e) {
        console.error("Failed to parse events", e);
      }
    }
  }, []);

  // Save events on change
  useEffect(() => {
    localStorage.setItem('voice-calendar-events', JSON.stringify(events));
  }, [events]);

  // Speech Recognition Setup
  useEffect(() => {
    if (!SpeechRecognition) {
      setErrorMsg("Speech Recognition API is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setStatus('listening');
      setTranscript('');
      setErrorMsg('');
    };

    recognition.onresult = (event) => {
      let currentTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        currentTranscript += event.results[i][0].transcript;
      }
      setTranscript(currentTranscript);
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error', event.error);
      setIsListening(false);
      setStatus('error');
      setErrorMsg(`Speech error: ${event.error}`);
      showToast(`Speech recognition error: ${event.error}`, 'error');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, []);

  // Process transcript after speech ends
  useEffect(() => {
    if (!isListening && transcript && status === 'listening') {
      setStatus('processing');
      processTranscript(transcript);
    }
  }, [isListening, transcript, status]);

  const processTranscript = async (text) => {
    try {
      const currentDateTime = new Date().toISOString().slice(0, 19);
      const currentEventsContext = events.length > 0 
        ? JSON.stringify(events.map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end })), null, 2)
        : "No current events.";

      const prompt = `You are a precise Calendar Intent Parsing Assistant.
Your job is to parse natural language calendar requests and return them strictly in JSON format.
The user may want to ADD new events, DELETE existing events, or UPDATE/MOVE existing events.

CURRENT DATETIME CONTEXT:
Today's date and time is: ${currentDateTime} (Format: YYYY-MM-DDTHH:mm:ss)

CURRENT EVENTS IN CALENDAR:
${currentEventsContext}

INSTRUCTIONS:
1. Determine the user's intent from the USER INPUT.
2. Resolve all relative dates (e.g., "tomorrow", "next Tuesday", "in 2 hours", "מחר", "יום שלישי הבא", "בעוד שעה") into exact absolute ISO-8601 dates and times (YYYY-MM-DDTHH:mm:ss).
3. If no specific time is mentioned for a new event, default the time to 09:00:00.
4. If the user wants to delete or update an event, use the exact "id" from the CURRENT EVENTS list that best matches their description.
5. Output ONLY valid, raw JSON. Do not include markdown formatting (no \`\`\`json), introductory text, or explanations.

JSON OUTPUT STRUCTURE:
{
  "actions": [
    {
      "action": "add",
      "title": "Event title",
      "start_time": "YYYY-MM-DDTHH:mm:ss",
      "end_time": "YYYY-MM-DDTHH:mm:ss or null"
    },
    {
      "action": "delete",
      "id": "ID of the event to delete"
    },
    {
      "action": "update",
      "id": "ID of the event to update",
      "title": "New title or null if unchanged",
      "start_time": "New start time or null if unchanged",
      "end_time": "New end time or null if unchanged"
    },
    {
      "action": "sync"
    }
  ]
}

USER INPUT:
"${text}"`;

      let data, rawText;

      if (llmMode === 'cloud') {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': import.meta.env.VITE_GEMINI_API_KEY
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ]
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Google AI Error (${response.status}): ${errText}`);
        }

        data = await response.json();
        rawText = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      } else {
        const response = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gemma2:9b',
            prompt: prompt,
            stream: false
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Ollama Error (${response.status}): ${errText}`);
        }

        data = await response.json();
        rawText = (data.response || "").trim();
      }

      let parsedActions = [];
      try {
        // Remove markdown code blocks if the model wrapped the JSON
        if (rawText.startsWith('```json')) {
          rawText = rawText.substring(7);
        } else if (rawText.startsWith('```')) {
          rawText = rawText.substring(3);
        }
        if (rawText.endsWith('```')) {
          rawText = rawText.substring(0, rawText.length - 3);
        }
        rawText = rawText.trim();
        
        const jsonResponse = JSON.parse(rawText);
        setLlmOutput(JSON.stringify(jsonResponse, null, 2));
        parsedActions = jsonResponse.actions || [];
      } catch (e) {
        throw new Error(`Invalid JSON response from LLM:\n${data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data)}`);
      }

      if (!parsedActions || parsedActions.length === 0) {
        setErrorMsg("Could not detect any actions. Please try again.");
        showToast(language === 'he-IL' ? "לא זוהתה פעולה. נסה שוב!" : "Could not detect an action. Try again!", 'error');
        setStatus('idle');
        return;
      }

      let nextEvents = [...events];
      let hasSyncAction = false;

      parsedActions.forEach((act, index) => {
        if (act.action === 'sync') {
          hasSyncAction = true;
        } else if (act.action === 'add') {
          let start = new Date();
          if (act.start_time) start = new Date(act.start_time);
          let end = new Date(start.getTime() + 60 * 60 * 1000);
          if (act.end_time) end = new Date(act.end_time);

          nextEvents.push({
            id: String(Date.now() + index),
            title: act.title || (language === 'he-IL' ? "אירוע חדש" : "New Event"),
            start: start.toISOString(),
            end: end.toISOString(),
          });

          if (calendarRef.current) {
            try {
              calendarRef.current.getApi().gotoDate(start);
            } catch(e){}
          }
        } else if (act.action === 'delete') {
          nextEvents = nextEvents.filter(e => e.id !== String(act.id));
        } else if (act.action === 'update') {
          nextEvents = nextEvents.map(e => {
            if (e.id === String(act.id)) {
              let start = e.start;
              if (act.start_time) start = new Date(act.start_time).toISOString();
              let end = e.end;
              if (act.end_time) end = new Date(act.end_time).toISOString();
              if (act.start_time && !act.end_time) {
                end = new Date(new Date(act.start_time).getTime() + 60 * 60 * 1000).toISOString();
              }
              return {
                ...e,
                title: act.title || e.title,
                start,
                end
              };
            }
            return e;
          });
        }
      });

      setEvents(nextEvents);

      if (hasSyncAction) {
        syncToGoogleCalendar(nextEvents);
      }

      const msg = language === 'he-IL' ? 'לוח השנה עודכן בהצלחה!' : 'Calendar updated successfully!';
      showToast(msg, 'success');
      setStatus('idle');
      setTranscript('');
    } catch (error) {
      console.error(error);
      setErrorMsg(error.message);
      setLlmOutput(`Error Details:\n${error.message}`);
      showToast(language === 'he-IL' ? "שגיאה בתהליך. ראה פאנל למטה." : "Error occurred. See panel.", 'error');
      setStatus('idle');
    }
  };

  const toggleListen = () => {
    if (sttMode === 'server') {
      if (isListening) {
        recognitionRef.current?.stop();
      } else {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.lang = language;
            recognitionRef.current.start();
          } catch (e) {
            console.error(e);
          }
        }
      }
    } else {
      if (isListening) {
        mediaRecorderRef.current?.stop();
        setIsListening(false);
        setStatus('processing');
      } else {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = event => {
              if (event.data.size > 0) {
                audioChunksRef.current.push(event.data);
              }
            };

            mediaRecorder.onstop = async () => {
              const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
              const formData = new FormData();
              formData.append('audio', audioBlob, 'audio.webm');
              
              try {
                const res = await fetch('http://127.0.0.1:5001/transcribe', {
                  method: 'POST',
                  body: formData
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Local Whisper API error');
                
                if (!data.text) {
                  showToast(language === 'he-IL' ? "לא זוהה דיבור בקובץ הקול" : "No speech detected in audio", 'error');
                  setStatus('idle');
                  return;
                }

                setTranscript(data.text);
                processTranscript(data.text);
              } catch (e) {
                console.error(e);
                const errMsg = language === 'he-IL' 
                  ? "שגיאה בחיבור לשרת ה-Whisper המקומי (server.py אינו פועל?)" 
                  : "Local Whisper connection error. Is server.py running?";
                setErrorMsg(errMsg);
                showToast(errMsg, 'error');
                setStatus('idle');
              }
              
              stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setIsListening(true);
            setStatus('listening');
            setTranscript('');
            setErrorMsg('');

            // Automatic silence detection (VAD) & max duration safety
            try {
              const audioContext = new (window.AudioContext || window.webkitAudioContext)();
              const source = audioContext.createMediaStreamSource(stream);
              const analyser = audioContext.createAnalyser();
              analyser.fftSize = 512;
              source.connect(analyser);

              const dataArray = new Uint8Array(analyser.frequencyBinCount);
              let silenceStart = Date.now();
              let speechDetected = false;
              const maxRecordingTime = 15000; // 15s max auto stop
              const startTime = Date.now();

              const checkAudio = () => {
                if (mediaRecorder.state !== 'recording') {
                  try { audioContext.close(); } catch(e){}
                  return;
                }

                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                  sum += dataArray[i];
                }
                const average = sum / dataArray.length;

                if (average > 10) {
                  speechDetected = true;
                  silenceStart = Date.now();
                }

                const elapsed = Date.now() - startTime;
                const silenceDuration = Date.now() - silenceStart;

                // Stop if 1.8s silence after speech, or 15s total elapsed
                if ((speechDetected && silenceDuration > 1800) || elapsed > maxRecordingTime) {
                  if (mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                    setIsListening(false);
                    setStatus('processing');
                  }
                  try { audioContext.close(); } catch(e){}
                  return;
                }

                requestAnimationFrame(checkAudio);
              };

              requestAnimationFrame(checkAudio);
            } catch (e) {
              console.log("AudioContext VAD fallback unavailable", e);
            }
          })
          .catch(e => {
            console.error(e);
            const errMsg = language === 'he-IL' ? 'גישה למיקרופון נדחתה.' : 'Microphone access denied.';
            setErrorMsg(errMsg);
            showToast(errMsg, 'error');
            setStatus('idle');
          });
      }
    }
  };

  const handlePromptClick = (promptText) => {
    setTranscript(promptText);
    setStatus('processing');
    processTranscript(promptText);
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualTitle || !manualDate) return;

    const startDateTime = new Date(`${manualDate}T${manualTime || '10:00'}`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    const newEvent = {
      id: String(Date.now()),
      title: manualTitle,
      start: startDateTime.toISOString(),
      end: endDateTime.toISOString(),
    };

    setEvents(prev => [...prev, newEvent]);
    showToast(language === 'he-IL' ? `אירוע "${manualTitle}" נוסף!` : `Event "${manualTitle}" added!`, 'success');
    setIsManualModalOpen(false);
    setManualTitle('');
    setManualDate('');
  };

  const handleEventClick = (clickInfo) => {
    const confirmDelete = window.confirm(
      language === 'he-IL'
        ? `האם למחוק את האירוע '${clickInfo.event.title}'?`
        : `Delete event '${clickInfo.event.title}'?`
    );
    if (confirmDelete) {
      setEvents(prev => prev.filter(event => event.id !== clickInfo.event.id));
      showToast(language === 'he-IL' ? "האירוע נמחק" : "Event deleted", 'success');
    }
  };

  const clearAllEvents = () => {
    if (events.length === 0) return;
    const confirmClear = window.confirm(
      language === 'he-IL' ? "האם למחוק את כל האירועים?" : "Are you sure you want to clear all events?"
    );
    if (confirmClear) {
      setEvents([]);
      showToast(language === 'he-IL' ? "כל האירועים נמחקו" : "All events cleared", 'success');
    }
  };

  const syncToGoogleCalendar = async (eventsToSync = events) => {
    if (eventsToSync.length === 0) {
      showToast(language === 'he-IL' ? "אין אירועים לסנכרון" : "No events to sync", 'error');
      return;
    }
    try {
      showToast(language === 'he-IL' ? "מסנכרן ליומן גוגל..." : "Syncing to Google Calendar...", 'success');
      const res = await fetch('http://127.0.0.1:5001/sync_calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: eventsToSync })
      });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      showToast(language === 'he-IL' ? "סונכרן בהצלחה ליומן גוגל!" : "Synced successfully to Google Calendar!", 'success');
    } catch (e) {
      console.error(e);
      showToast(language === 'he-IL' ? "שגיאה בסנכרון. האם השרת פועל?" : "Sync error. Is server running?", 'error');
    }
  };

  const exportToGoogleCalendar = () => {
    if (events.length === 0) {
      showToast(language === 'he-IL' ? "אין אירועים לייצוא" : "No events to export", 'error');
      return;
    }

    const formatDate = (isoString) => {
      const d = new Date(isoString);
      return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Voice Calendar//EN\n";
    events.forEach(event => {
      icsContent += "BEGIN:VEVENT\n";
      icsContent += `UID:${event.id}@voicecalendar\n`;
      icsContent += `DTSTAMP:${formatDate(new Date().toISOString())}\n`;
      icsContent += `DTSTART:${formatDate(event.start)}\n`;
      icsContent += `DTEND:${formatDate(event.end)}\n`;
      icsContent += `SUMMARY:${event.title}\n`;
      icsContent += "END:VEVENT\n";
    });
    icsContent += "END:VCALENDAR";

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'voice-calendar-events.ics';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast(language === 'he-IL' ? "קובץ לוח השנה הורד בהצלחה!" : "Calendar file downloaded!", 'success');
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-100 p-4 md:p-6 selection:bg-indigo-500 selection:text-white overflow-hidden flex flex-col">
      {/* Background Glow Decorations */}
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-10 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Main Container */}
      <div className="max-w-[1400px] mx-auto w-full h-full flex flex-col space-y-4">

        {/* Toast Notification Banner */}
        {notification && (
          <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border transition-all animate-bounce ${
            notification.type === 'error'
              ? 'bg-rose-950/80 border-rose-500/40 text-rose-200'
              : 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
          }`}>
            {notification.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
            <span className="text-sm font-medium">{notification.text}</span>
          </div>
        )}

        {/* Header Dashboard */}
        <header className="glass-panel shrink-0 p-4 md:p-6 rounded-3xl shadow-2xl relative overflow-hidden flex flex-col lg:flex-row items-center justify-between gap-4 border border-slate-800">
          
          {/* Logo & App Title */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <CalendarIcon className="text-white" size={24} />
              </div>
              <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            </div>

            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl md:text-2xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-200 bg-clip-text text-transparent">
                  Voice Calendar
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">
                  Offline AI
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {language === 'he-IL' ? 'תזמון קולי חכם בלייב' : 'Smart Live Voice Scheduling'}
              </p>
            </div>
          </div>

          {/* Controls: Language Switcher + Manual Event Button + Clear All */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* Language Selector Pills */}
            <div className="flex p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
              <button
                onClick={() => setLanguage('he-IL')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  language === 'he-IL'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🇮🇱 עברית
              </button>
              <button
                onClick={() => setLanguage('en-US')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  language === 'en-US'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🇺🇸 English
              </button>
            </div>

            {/* STT Engine Selector Pills */}
            <div className="flex p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
              <button
                onClick={() => setSttMode('server')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  sttMode === 'server'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Web Speech API"
              >
                <Cloud size={14} />
                Web STT
              </button>
              <button
                onClick={() => setSttMode('local')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  sttMode === 'local'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Local MLX Whisper"
              >
                <Server size={14} />
                Whisper
              </button>
            </div>

            {/* Model Selector Pills */}
            <div className="flex p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
              <button
                onClick={() => setLlmMode('cloud')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  llmMode === 'cloud'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Google Gemini Cloud"
              >
                <Cloud size={14} />
                Cloud
              </button>
              <button
                onClick={() => setLlmMode('local')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  llmMode === 'local'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Local Ollama (gemma2:9b)"
              >
                <Server size={14} />
                Local
              </button>
            </div>

            {/* Add Manual Event Button */}
            <button
              onClick={() => setIsManualModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl transition-all hover:scale-105 active:scale-95"
            >
              <Plus size={14} />
              {language === 'he-IL' ? 'אירוע ידני' : 'Manual Event'}
            </button>

            {/* Export & Clear All Events */}
            {events.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => syncToGoogleCalendar(events)}
                  title={language === 'he-IL' ? 'סנכרון אוטומטי ל-Google Calendar' : 'Auto-Sync to Google Calendar'}
                  className="p-1.5 text-slate-400 hover:text-blue-400 bg-slate-900/80 hover:bg-blue-950/40 border border-slate-800 hover:border-blue-900/50 rounded-xl transition-all"
                >
                  <Globe size={16} />
                </button>
                <button
                  onClick={exportToGoogleCalendar}
                  title={language === 'he-IL' ? 'ייצוא ל-Google Calendar (.ics)' : 'Export to Google Calendar'}
                  className="p-1.5 text-slate-400 hover:text-emerald-400 bg-slate-900/80 hover:bg-emerald-950/40 border border-slate-800 hover:border-emerald-900/50 rounded-xl transition-all"
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={clearAllEvents}
                  title={language === 'he-IL' ? 'ניקוי כל האירועים' : 'Clear All Events'}
                  className="p-1.5 text-slate-400 hover:text-rose-400 bg-slate-900/80 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/50 rounded-xl transition-all"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
          {/* Left Column (Controls & Info) */}
          <div className="flex flex-col gap-4 w-full lg:w-1/3 h-full overflow-y-auto pr-1 pb-1">
            
            {/* Hero Interactive Voice Action Section */}
            <section className="glass-panel p-5 rounded-3xl shadow-xl flex flex-col items-center justify-center text-center space-y-4 border border-slate-800/80 relative overflow-hidden shrink-0">
              
              {/* Audio Waves Effect when Listening */}
              {isListening && (
                <div className="flex items-center gap-1.5 h-6 my-1">
                  <span className="w-1.5 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.4s] h-6" />
                  <span className="w-1.5 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.2s] h-8" />
                  <span className="w-1.5 bg-rose-500 rounded-full animate-bounce h-10" />
                  <span className="w-1.5 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.2s] h-8" />
                  <span className="w-1.5 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.4s] h-6" />
                </div>
              )}

              {/* Voice Microphone Big Button */}
              <button
                onClick={toggleListen}
                disabled={status === 'processing' || (sttMode === 'server' && !SpeechRecognition)}
                className={`group relative flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-bold text-base text-white transition-all transform hover:scale-105 active:scale-95 shadow-xl ${
                  isListening
                    ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/40 animate-mic-wave'
                    : status === 'processing'
                    ? 'bg-slate-700 cursor-not-allowed text-slate-400'
                    : 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-blue-600 hover:from-indigo-500 hover:to-blue-500 shadow-indigo-500/30'
                }`}
              >
                {isListening ? (
                  <>
                    <MicOff className="animate-spin" size={20} />
                    <span>{language === 'he-IL' ? 'עצור מקליט...' : 'Stop Recording...'}</span>
                  </>
                ) : status === 'processing' ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    <span>{language === 'he-IL' ? 'מעבד...' : 'Processing...'}</span>
                  </>
                ) : (
                  <>
                    <Mic className="group-hover:scale-110 transition-transform" size={20} />
                    <span>{language === 'he-IL' ? 'דבר ליצירת אירוע' : 'Tap & Speak Event'}</span>
                  </>
                )}
              </button>

              {/* Transcript Display */}
              <div className="w-full max-w-lg min-h-[2.5rem] flex items-center justify-center">
                {transcript ? (
                  <div className="px-3 py-1.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-indigo-200 text-xs italic animate-fade-in shadow-inner">
                    "{transcript}"
                  </div>
                ) : isListening && sttMode === 'local' ? (
                  <p className="text-xs text-rose-400 font-medium animate-pulse">
                    {language === 'he-IL'
                      ? '🎙 מקליט ב-Whisper... אמור את הפקודה (ייעצר אוטומטית כשתשתוק)'
                      : '🎙 Recording with Whisper... Speak command (auto-stops on silence)'}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    {language === 'he-IL'
                      ? 'לחץ על הכפתור ואמור למשל: "פגישת צוות מחר ב-3 בצהריים"'
                      : 'Click the button and say e.g. "Team sync tomorrow at 3 PM"'}
                  </p>
                )}
              </div>

              {/* Quick Example Prompt Chips */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                  <Sparkles size={10} className="text-indigo-400" />
                  {language === 'he-IL' ? 'ניסוי מהיר:' : 'Quick try:'}
                </span>
                {EXAMPLE_PROMPTS[language].map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handlePromptClick(prompt)}
                    className="text-[10px] bg-slate-900/90 hover:bg-indigo-950/60 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 px-2.5 py-1 rounded-full transition-all hover:scale-105 active:scale-95"
                  >
                    "{prompt}"
                  </button>
                ))}
              </div>
            </section>

            {/* LLM Output Section */}
            {llmOutput && (
              <section className="glass-panel p-5 rounded-3xl shadow-xl border border-slate-800/80 shrink-0">
                <h3 className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-2">
                  <Sparkles size={14} className="text-indigo-400" />
                  {language === 'he-IL' ? 'פלט ה-LLM (JSON)' : 'LLM Output (JSON)'}
                </h3>
                <pre className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/50 text-[10px] md:text-xs text-emerald-400 overflow-x-auto whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                  {llmOutput}
                </pre>
              </section>
            )}

            {/* Event List Section */}
            <section className="glass-panel p-5 rounded-3xl shadow-xl border border-slate-800/80 flex-1 min-h-[200px] flex flex-col">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <CalendarIcon size={14} className="text-indigo-400" />
                  {language === 'he-IL' ? 'רשימת אירועים' : 'Events List'}
                </h3>
                <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                  {events.length}
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-1 space-y-2">
                {events.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">
                    {language === 'he-IL' ? 'אין אירועים עדיין' : 'No events yet'}
                  </p>
                ) : (
                  events.map(event => (
                    <div key={event.id} className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 flex items-start justify-between gap-2 hover:bg-slate-800/60 transition-colors">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium text-slate-200 truncate">{event.title}</span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(event.start).toLocaleString(language === 'he-IL' ? 'he-IL' : 'en-US', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <button 
                        onClick={() => {
                          if (window.confirm(language === 'he-IL' ? `למחוק את '${event.title}'?` : `Delete '${event.title}'?`)) {
                            setEvents(prev => prev.filter(e => e.id !== event.id));
                          }
                        }}
                        className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors shrink-0"
                        title={language === 'he-IL' ? 'מחק אירוע' : 'Delete event'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          {/* Right Column (Calendar) */}
          <main className="glass-panel p-4 rounded-3xl shadow-2xl border border-slate-800 w-full lg:w-2/3 h-[500px] lg:h-full flex flex-col shrink-0 lg:shrink">
            <div className="flex-1 min-h-0 bg-slate-950/30 rounded-2xl p-2 relative overflow-y-auto">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin]}
                initialView="timeGridWeek"
                headerToolbar={{
                  left: 'prev,next today',
                  center: 'title',
                  right: 'dayGridMonth,timeGridWeek,timeGridDay'
                }}
                events={events}
                eventClick={handleEventClick}
                height="100%"
                nowIndicator={true}
                allDaySlot={false}
              />
            </div>
          </main>
        </div>
      </div>

      {/* Manual Event Creation Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl border border-slate-700 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                <Plus size={20} className="text-indigo-400" />
                {language === 'he-IL' ? 'הוספת אירוע ידני' : 'Add Manual Event'}
              </h3>
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  {language === 'he-IL' ? 'שם האירוע' : 'Event Title'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={language === 'he-IL' ? 'לדוגמה: פגישת עבודה' : 'e.g. Work Meeting'}
                  value={manualTitle}
                  onChange={e => setManualTitle(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    {language === 'he-IL' ? 'תאריך' : 'Date'}
                  </label>
                  <input
                    type="date"
                    required
                    value={manualDate}
                    onChange={e => setManualDate(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 outline-none focus:border-indigo-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    {language === 'he-IL' ? 'שעה' : 'Time'}
                  </label>
                  <input
                    type="time"
                    required
                    value={manualTime}
                    onChange={e => setManualTime(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 outline-none focus:border-indigo-500 transition-all"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl"
                >
                  {language === 'he-IL' ? 'ביטול' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-600/30 transition-all"
                >
                  {language === 'he-IL' ? 'שמור אירוע' : 'Save Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
