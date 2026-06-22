import { useState, useRef } from "react"
import * as webllm from "@mlc-ai/web-llm"
import supabase from "./supabase"
import "./App.css"

const MODEL = "Mistral-7B-Instruct-v0.3-q4f16_1-MLC"

function App() {
  const [pin, setPin] = useState("")
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginError, setLoginError] = useState("")
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState("")
  const [slowLoad, setSlowLoad] = useState(false)
  const [error, setError] = useState("")
  const [cards, setCards] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [cardCount, setCardCount] = useState("8")
  const [quizMode, setQuizMode] = useState(false)
  const [userAnswer, setUserAnswer] = useState("")
  const [quizIndex, setQuizIndex] = useState(0)
  const [quizResult, setQuizResult] = useState(null)
  const [quizScore, setQuizScore] = useState({ correct: 0, total: 0 })
  const [shuffledCards, setShuffledCards] = useState([])
  const [savedDecks, setSavedDecks] = useState([])
  const engineRef = useRef(null)

  async function handleLogin() {
    if (!pin.trim()) return
    setLoginError("")

    const { data } = await supabase
      .from("users")
      .select("pin")
      .eq("pin", pin)
      .single()

    if (data) {
      setLoggedIn(true)
      loadSavedDecks(pin)
    } else {
      setLoginError("PIN not found. Would you like to create an account?")
    }
  }

  async function handleCreateAccount() {
    if (!pin.trim()) return
    setLoginError("")

    const { error } = await supabase
      .from("users")
      .insert([{ pin }])

    if (error) {
      setLoginError("That PIN is already taken, try another one!")
    } else {
      setLoggedIn(true)
      setSavedDecks([])
    }
  }

  async function loadSavedDecks(userPin) {
    const { data } = await supabase
      .from("decks")
      .select("*")
      .eq("user_pin", userPin)
      .order("created_at", { ascending: false })

    if (data) setSavedDecks(data)
  }

  async function generateDeckTitle(notesText) {
    const engine = await getEngine()

    const reply = await engine.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You create short flashcard deck titles. Return ONLY a short title, 2-5 words. Do not use quotes. Do not add extra text."
        },
        {
          role: "user",
          content: `Create a short title for these notes:\n\n${notesText}`
        }
      ],
      temperature: 0.3,
      max_tokens: 30
    })

    let title = reply.choices[0].message.content.trim()

    title = title
      .replace(/^["']|["']$/g, "")
      .replace(/^title:\s*/i, "")
      .trim()

    if (!title) title = "Untitled Deck"

    return title
  }

  async function saveDeck(notesText, generatedCards) {
    const notesHash = btoa(encodeURIComponent(notesText)).slice(0, 50)
    const name = await generateDeckTitle(notesText)

    await supabase
      .from("decks")
      .insert([{
        user_pin: pin,
        notes_hash: notesHash,
        notes: notesText,
        name,
        cards: generatedCards
      }])

    loadSavedDecks(pin)
  }

  async function checkExistingDeck(notesText) {
    const notesHash = btoa(encodeURIComponent(notesText)).slice(0, 50)

    const { data } = await supabase
      .from("decks")
      .select("*")
      .eq("user_pin", pin)
      .eq("notes_hash", notesHash)
      .single()

    return data
  }

  async function getEngine() {
    if (engineRef.current) return engineRef.current
    const engine = await webllm.CreateMLCEngine(MODEL, {
      initProgressCallback: (progress) => {
        const pct = Math.round(progress.progress * 100)
        setLoadingMessage(`Downloading model... ${pct}%`)
      }
    })
    engineRef.current = engine
    return engine
  }

  async function generateFlashcards() {
    if (!notes.trim()) return
    setLoading(true)
    setError("")
    setCards([])
    setSlowLoad(false)

    const existing = await checkExistingDeck(notes)
    if (existing) {
      setCards(existing.cards)
      setCurrentIndex(0)
      setFlipped(false)
      setLoading(false)
      return
    }

    setLoadingMessage("Loading AI model...")
    const slowTimer = setTimeout(() => setSlowLoad(true), 30000)
    const needed = parseInt(cardCount) || 8

    function parseCards(raw) {
      const questions = [...raw.matchAll(/"question"\s*:\s*"([^"]+)"/g)].map(m => m[1])
      const answers = [...raw.matchAll(/"answer"\s*:\s*"([^"]+)"/g)].map(m => m[1])
      const result = []
      for (let i = 0; i < Math.min(questions.length, answers.length); i++) {
        result.push({ question: questions[i], answer: answers[i] })
      }
      return result
    }

    try {
      const engine = await getEngine()
      let allCards = []
      let attempts = 0

      while (allCards.length < needed && attempts < 3) {
        const remaining = needed - allCards.length
        setLoadingMessage(`Generating flashcards... (${allCards.length}/${needed})`)

        const reply = await engine.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are a flashcard generator. Return ONLY a JSON array with no extra text.
              Each item must have a "question" and "answer" field.
              Make answers detailed and thorough, at least 2-3 sentences each.
              Example: [{"question": "What is X?", "answer": "X is... It works by... This is important because..."}]`
            },
            {
              role: "user",
              content: `Generate EXACTLY ${remaining} flashcards from these notes. Return exactly ${remaining} items in the array, no more no less: ${notes}`
            }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })

        const text = reply.choices[0].message.content
        const newCards = parseCards(text)
        allCards = [...allCards, ...newCards]
        attempts++
      }

      const finalCards = allCards.slice(0, needed)
      if (finalCards.length === 0) throw new Error("Could not generate flashcards")
      setCards(finalCards)
      setCurrentIndex(0)
      setFlipped(false)
      await saveDeck(notes, finalCards)

    } catch (err) {
      setError("Something went wrong: " + err.message)
    }

    clearTimeout(slowTimer)
    setSlowLoad(false)
    setLoading(false)
    setLoadingMessage("")
  }

  async function deleteAccount() {
    const confirmed = window.confirm(
      "Are you sure you want to delete your account? This will permanently delete all saved flashcards."
    )

    if (!confirmed) return

    try {
      await supabase
        .from("decks")
        .delete()
        .eq("user_pin", pin)

      await supabase
        .from("users")
        .delete()
        .eq("pin", pin)

      setLoggedIn(false)
      setPin("")
      setNotes("")
      setCards([])
      setSavedDecks([])
      setCurrentIndex(0)
      setFlipped(false)

      alert("Account deleted successfully.")
    } catch (err) {
      alert("Failed to delete account.")
      console.error(err)
    }
  }

  function handlePrev() {
    setCurrentIndex((i) => Math.max(i - 1, 0))
    setFlipped(false)
  }

  function handleNext() {
    setCurrentIndex((i) => Math.min(i + 1, cards.length - 1))
    setFlipped(false)
  }

  function startQuiz() {
    const shuffled = [...cards].sort(() => Math.random() - 0.5)
    setShuffledCards(shuffled)
    setQuizMode(true)
    setQuizIndex(0)
    setUserAnswer("")
    setQuizResult(null)
    setQuizScore({ correct: 0, total: 0 })
  }

  function nextQuizCard(correct) {
    if (correct) {
      setQuizScore(s => ({ ...s, correct: s.correct + 1 }))
    }
    if (quizIndex + 1 < shuffledCards.length) {
      setQuizIndex(i => i + 1)
      setUserAnswer("")
      setQuizResult(null)
    } else {
      setQuizMode(false)
    }
  }

  if (!loggedIn) {
    return (
      <div className="container">
        <div className="login-box">
          <h1>Flashcard Generator</h1>
          <p>Enter your PIN to login or create a new account</p>

          <input
            className="pin-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Enter your PIN..."
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />

          {loginError && <p className="login-error">{loginError}</p>}

          <button className="generate-btn" onClick={handleLogin}>
            Login
          </button>

          <button className="create-btn" onClick={handleCreateAccount}>
            Create Account
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="top-bar">
        <h1>Flashcard Generator</h1>

        <div className="top-buttons">
          <button
            className="logout-btn"
            onClick={() => {
              setLoggedIn(false)
              setPin("")
              setCards([])
              setNotes("")
              setSavedDecks([])
            }}
          >
            Logout
          </button>

          <button className="delete-account-btn" onClick={deleteAccount}>
            Delete
          </button>
        </div>
      </div>
      <p>Paste your notes below and AI will turn them into flashcards</p>

      {savedDecks.length > 0 && (
        <div className="saved-decks">
          <p className="saved-label">Your saved decks:</p>
          <div className="deck-list">
            {savedDecks.map((deck) => (
              <button
                key={deck.id}
                className="deck-btn"
                onClick={() => {
                  setNotes(deck.notes)
                  setCards(deck.cards)
                  setCurrentIndex(0)
                  setFlipped(false)
                }}
              >
                {deck.name || "Untitled Deck"}
              </button>
            ))}
          </div>
        </div>
      )}

      <textarea
        className="notes-input"
        placeholder="Paste your notes here..."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="card-count">
        <label>Number of flashcards</label>
        <input
          type="number"
          min="1"
          max="20"
          value={cardCount}
          onChange={(e) => setCardCount(e.target.value)}
          onBlur={(e) => {
            const val = Math.min(20, Math.max(1, parseInt(e.target.value) || 8))
            setCardCount(String(val))
          }}
        />
      </div>

      {error && <p className="error">{error}</p>}
      {loadingMessage && (
        <div>
          <p className="loading-msg">{loadingMessage}</p>
          {slowLoad && (
            <p className="slow-load">⏳ Taking longer than expected... the model is still downloading, hang tight!</p>
          )}
        </div>
      )}

      <button className="generate-btn" onClick={generateFlashcards} disabled={loading}>
        {loading ? "Loading..." : "Generate Flashcards"}
      </button>

      {cards.length > 0 && (
        <div className="cards-section">
          <p className="card-counter">{currentIndex + 1} / {cards.length}</p>

          <div className={`card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(!flipped)}>
            <div className="card-inner">
              <div className="card-front">
                <p>{cards[currentIndex].question}</p>
                <span className="hint">Click to reveal answer</span>
              </div>
              <div className="card-back">
                <p>{cards[currentIndex].answer}</p>
                <span className="hint">Click to see question</span>
              </div>
            </div>
          </div>

          <div className="nav-buttons">
            <button className="nav-btn" onClick={handlePrev} disabled={currentIndex === 0}>
              ← Prev
            </button>
            <button className="nav-btn" onClick={handleNext} disabled={currentIndex === cards.length - 1}>
              Next →
            </button>
          </div>

          <button className="quiz-btn" onClick={startQuiz}>
            ✏️ Try it yourself
          </button>
        </div>
      )}

      {quizMode && (
        <div className="quiz-overlay">
          <div className="quiz-box">
            <div className="quiz-header">
              <p className="quiz-counter">{quizIndex + 1} / {shuffledCards.length}</p>
              <p className="quiz-score">✅ {quizScore.correct} / {quizScore.total}</p>
              <button className="quiz-close" onClick={() => setQuizMode(false)}>✕</button>
            </div>

            <p className="quiz-question">{shuffledCards[quizIndex]?.question}</p>

            {quizResult === null ? (
              <>
                <textarea
                  className="quiz-input"
                  placeholder="Type your answer..."
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                />
                <button
                  className="quiz-check-btn"
                  onClick={() => {
                    if (!userAnswer.trim()) return
                    setQuizResult(shuffledCards[quizIndex].answer)
                    setQuizScore(s => ({ ...s, total: s.total + 1 }))
                  }}
                >
                  Check Answer
                </button>
              </>
            ) : (
              <>
                <div className="quiz-answer">
                  <p className="quiz-answer-label">Correct Answer:</p>
                  <p>{quizResult}</p>
                </div>
                <p className="quiz-your-answer-label">Your Answer: <span>{userAnswer}</span></p>
                <div className="quiz-feedback-btns">
                  <button className="quiz-correct-btn" onClick={() => nextQuizCard(true)}>
                    ✅ Got it
                  </button>
                  <button className="quiz-wrong-btn" onClick={() => nextQuizCard(false)}>
                    ❌ Missed it
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
