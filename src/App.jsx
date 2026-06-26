import { useState, useRef, useEffect } from "react"
import * as webllm from "@mlc-ai/web-llm"
import supabase from "./supabase"
import "./App.css"

const DESKTOP_MODEL = "Mistral-7B-Instruct-v0.3-q4f16_1-MLC"

function isMobileDevice() {
  return (
    window.innerWidth <= 768 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  )
}

function App() {
  const [firstName, setFirstName] = useState("")
  const [numberId, setNumberId] = useState("")
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginError, setLoginError] = useState("")
  const [loginLoading, setLoginLoading] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
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
  const [quizFinished, setQuizFinished] = useState(false)
  const [shuffledCards, setShuffledCards] = useState([])
  const [savedDecks, setSavedDecks] = useState([])
  const [selectedDeckIds, setSelectedDeckIds] = useState({})
  const [activeDeckName, setActiveDeckName] = useState("")
  const [aiFeedback, setAiFeedback] = useState("")
  const [aiCorrect, setAiCorrect] = useState(null)
  const [checkingAnswer, setCheckingAnswer] = useState(false)
  const [isShuffling, setIsShuffling] = useState(false)
  const [isSwitchingCard, setIsSwitchingCard] = useState(false)

  const engineRef = useRef(null)
  const notesRef = useRef(null)

  const cleanFirstName = firstName.trim().toLowerCase()
  const cleanNumberId = numberId.trim()
  const userKey = `${cleanFirstName}-${cleanNumberId}`

  function resizeNotesBox() {
    const box = notesRef.current
    if (!box) return

    const maxHeight = 360

    box.style.height = "auto"

    const newHeight = Math.min(box.scrollHeight, maxHeight)

    box.style.height = `${newHeight}px`
    box.style.overflowY = box.scrollHeight > maxHeight ? "auto" : "hidden"
  }

  useEffect(() => {
    resizeNotesBox()
  }, [notes])

  async function getEngine() {
    if (isMobileDevice()) {
      throw new Error(
        "Mobile does not have the capability to run AI. Please use a laptop or desktop."
      )
    }

    if (engineRef.current) return engineRef.current

    const engine = await webllm.CreateMLCEngine(DESKTOP_MODEL, {
      initProgressCallback: (progress) => {
        const pct = Math.round(progress.progress * 100)
        setLoadingMessage(`Downloading model... ${pct}%`)
      }
    })

    engineRef.current = engine
    return engine
  }

  async function checkAnswerWithAI(answerOverride = null) {
    if (isMobileDevice()) {
      setAiCorrect(false)
      setAiFeedback(
        "AI checking is disabled on mobile because loading the browser AI model can crash."
      )
      setQuizResult(shuffledCards[quizIndex]?.answer || "")
      return
    }

    const answerToCheck = (answerOverride ?? userAnswer).trim()

    if (!answerToCheck) return
    if (!shuffledCards[quizIndex]) return
    if (checkingAnswer) return

    setCheckingAnswer(true)
    setAiFeedback("")
    setAiCorrect(null)

    try {
      const engine = await getEngine()
      const currentCard = shuffledCards[quizIndex]

      const reply = await engine.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are a strict but helpful flashcard quiz grader.

Return ONLY valid JSON in this exact format:
{
  "correct": true,
  "feedback": "short helpful feedback"
}

Rules:
- If the student's answer is mostly correct, use true.
- If it is wrong, too incomplete, or missing the main idea, use false.
- Keep feedback 1-2 sentences.
- Do not add anything outside the JSON.`
          },
          {
            role: "user",
            content: `Question: ${currentCard.question}

Correct answer: ${currentCard.answer}

Student answer: ${answerToCheck}

Grade the student answer.`
          }
        ],
        temperature: 0.2,
        max_tokens: 250
      })

      let text = reply.choices[0].message.content.trim()
      text = text.replace(/```json/g, "").replace(/```/g, "").trim()

      let result

      try {
        result = JSON.parse(text)
      } catch {
        result = {
          correct: false,
          feedback:
            "The AI could not grade this clearly. Compare your answer with the correct answer below."
        }
      }

      const isCorrect = result.correct === true

      setAiCorrect(isCorrect)
      setAiFeedback(result.feedback || "No feedback given.")
      setQuizResult(currentCard.answer)

      setQuizScore((score) => ({
        correct: score.correct + (isCorrect ? 1 : 0),
        total: score.total + 1
      }))
    } catch (err) {
      console.error(err)
      setAiCorrect(false)
      setAiFeedback("Something went wrong while checking your answer.")
      setQuizResult(shuffledCards[quizIndex]?.answer || "")

      setQuizScore((score) => ({
        correct: score.correct,
        total: score.total + 1
      }))
    }

    setCheckingAnswer(false)
  }

  async function handleLogin() {
    if (!cleanFirstName || !cleanNumberId) {
      setLoginError("Please enter your first name and number ID.")
      return
    }

    setLoginError("")
    setLoginLoading(true)

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("first_name", cleanFirstName)
      .eq("number_id", cleanNumberId)
      .maybeSingle()

    if (error) {
      console.error("Login error:", error)
      setLoginError("Database error: " + error.message)
      setLoginLoading(false)
      return
    }

    if (data) {
      setLoggedIn(true)
      loadSavedDecks(userKey)
    } else {
      setLoginError("Account not found. Would you like to create one?")
    }

    setLoginLoading(false)
  }

  async function handleCreateAccount() {
    if (!cleanFirstName || !cleanNumberId) {
      setLoginError("Please enter your first name and number ID.")
      return
    }

    setLoginError("")
    setCreateLoading(true)

    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("*")
      .eq("first_name", cleanFirstName)
      .eq("number_id", cleanNumberId)
      .maybeSingle()

    if (checkError) {
      console.error("Create account check error:", checkError)
      setLoginError("Database error: " + checkError.message)
      setCreateLoading(false)
      return
    }

    if (existingUser) {
      setLoginError("That account already exists. Try logging in.")
      setCreateLoading(false)
      return
    }

    const { error } = await supabase.from("users").insert([
      {
        pin: userKey,
        first_name: cleanFirstName,
        number_id: cleanNumberId
      }
    ])

    if (error) {
      setLoginError("Could not create account: " + error.message)
    } else {
      setLoggedIn(true)
      setSavedDecks([])
    }

    setCreateLoading(false)
  }

  async function loadSavedDecks(currentUserKey) {
    const { data, error } = await supabase
      .from("decks")
      .select("*")
      .eq("user_pin", currentUserKey)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Load saved decks error:", error)
      setError("Could not load saved decks: " + error.message)
      return
    }

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
    title = title.replace(/^["']|["']$/g, "").replace(/^title:\s*/i, "").trim()

    if (!title) title = "Untitled Deck"

    return title
  }

  function makeNotesHash(notesText) {
    return btoa(encodeURIComponent(notesText)).slice(0, 50)
  }

  function getDeckCount(deck) {
    return deck.card_count || deck.cards?.length || 0
  }

  function loadDeck(deck) {
    setNotes(deck.notes)
    setCards(deck.cards)
    setCardCount(String(getDeckCount(deck) || 8))
    setCurrentIndex(0)
    setFlipped(false)
    setActiveDeckName(deck.name || "Untitled Deck")
    setQuizMode(false)
    setQuizFinished(false)
    setUserAnswer("")
    setQuizResult(null)
    setAiFeedback("")
    setAiCorrect(null)
    setIsShuffling(false)
    setIsSwitchingCard(false)
  }

  function getGroupedSavedDecks() {
    const groups = {}

    for (const deck of savedDecks) {
      const key = deck.notes_hash || makeNotesHash(deck.notes || "")

      if (!groups[key]) {
        groups[key] = {
          key,
          name: deck.name || "Untitled Deck",
          notes: deck.notes,
          decks: []
        }
      }

      groups[key].decks.push(deck)
    }

    return Object.values(groups).map((group) => ({
      ...group,
      decks: group.decks.sort((a, b) => getDeckCount(a) - getDeckCount(b))
    }))
  }

  async function saveDeck(notesText, generatedCards, count) {
    const notesHash = makeNotesHash(notesText)
    const name = await generateDeckTitle(notesText)

    const { error } = await supabase.from("decks").insert([
      {
        user_pin: userKey,
        notes_hash: notesHash,
        notes: notesText,
        name,
        cards: generatedCards,
        card_count: count
      }
    ])

    if (error) {
      console.error("Save deck error:", error)
      setError("Could not save deck: " + error.message)
      return
    }

    setActiveDeckName(name)
    loadSavedDecks(userKey)
  }

  async function checkExistingDeck(notesText, count) {
    const notesHash = makeNotesHash(notesText)

    const { data, error } = await supabase
      .from("decks")
      .select("*")
      .eq("user_pin", userKey)
      .eq("notes_hash", notesHash)
      .eq("card_count", count)
      .maybeSingle()

    if (error) {
      console.error("Check existing deck error:", error)
      return null
    }

    return data
  }

  async function generateFlashcards() {
    if (isMobileDevice()) {
      setError(
        "Mobile cannot safely run the AI model without crashing. Please generate flashcards on a laptop or desktop."
      )
      return
    }

    if (!notes.trim()) {
      setError("Please paste some notes first!")
      return
    }

    if (loading) return

    setLoading(true)
    setError("")
    setCards([])
    setActiveDeckName("")
    setSlowLoad(false)
    setLoadingMessage("")
    setIsShuffling(false)
    setIsSwitchingCard(false)

    const needed = parseInt(cardCount) || 8
    const existing = await checkExistingDeck(notes, needed)

    if (existing) {
      loadDeck(existing)
      setLoading(false)
      setLoadingMessage("")
      setSlowLoad(false)
      return
    }

    setLoadingMessage("Loading AI model...")
    const slowTimer = setTimeout(() => setSlowLoad(true), 30000)

    function parseCards(raw) {
      const questions = [...raw.matchAll(/"question"\s*:\s*"([^"]+)"/g)].map(
        (m) => m[1]
      )

      const answers = [...raw.matchAll(/"answer"\s*:\s*"([^"]+)"/g)].map(
        (m) => m[1]
      )

      const result = []

      for (let i = 0; i < Math.min(questions.length, answers.length); i++) {
        result.push({
          question: questions[i],
          answer: answers[i]
        })
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

      if (finalCards.length === 0) {
        throw new Error("Could not generate flashcards")
      }

      setCards(finalCards)
      setCurrentIndex(0)
      setFlipped(false)

      clearTimeout(slowTimer)
      setSlowLoad(false)
      setLoading(false)
      setLoadingMessage("")

      await saveDeck(notes, finalCards, needed)
    } catch (err) {
      console.error(err)
      setError("Something went wrong: " + err.message)

      clearTimeout(slowTimer)
      setSlowLoad(false)
      setLoading(false)
      setLoadingMessage("")
    }
  }

  async function deleteAccount() {
    const confirmed = window.confirm(
      "Are you sure you want to delete your account? This will permanently delete all saved flashcards."
    )

    if (!confirmed) return

    try {
      await supabase.from("decks").delete().eq("user_pin", userKey)

      await supabase
        .from("users")
        .delete()
        .eq("first_name", cleanFirstName)
        .eq("number_id", cleanNumberId)

      setLoggedIn(false)
      setFirstName("")
      setNumberId("")
      setNotes("")
      setCards([])
      setSavedDecks([])
      setSelectedDeckIds({})
      setCurrentIndex(0)
      setFlipped(false)
      setActiveDeckName("")
      setQuizMode(false)
      setIsShuffling(false)
      setIsSwitchingCard(false)

      alert("Account deleted successfully.")
    } catch (err) {
      alert("Failed to delete account.")
      console.error(err)
    }
  }

  async function deleteSavedDeck(deck) {
    const confirmed = window.confirm(
      `Delete saved deck "${deck.name || "Untitled Deck"}"?`
    )

    if (!confirmed) return

    const { error } = await supabase
      .from("decks")
      .delete()
      .eq("id", deck.id)
      .eq("user_pin", userKey)

    if (error) {
      console.error("Delete saved deck error:", error)
      setError("Could not delete saved deck: " + error.message)
      return
    }

    setSavedDecks((decks) => decks.filter((d) => d.id !== deck.id))

    setSelectedDeckIds((current) => {
      const next = { ...current }

      for (const key of Object.keys(next)) {
        if (String(next[key]) === String(deck.id)) {
          delete next[key]
        }
      }

      return next
    })

    const deletedCurrentDeck =
      notes === deck.notes && JSON.stringify(cards) === JSON.stringify(deck.cards)

    if (deletedCurrentDeck) {
      setCards([])
      setNotes("")
      setCurrentIndex(0)
      setFlipped(false)
      setActiveDeckName("")
      setQuizMode(false)
      setIsShuffling(false)
      setIsSwitchingCard(false)
    }
  }

  function switchCard(direction) {
    if (isSwitchingCard || isShuffling) return

    setIsSwitchingCard(true)
    setFlipped(false)

    setTimeout(() => {
      setCurrentIndex((current) => {
        const nextIndex = current + direction

        if (nextIndex < 0) return 0
        if (nextIndex > cards.length - 1) return cards.length - 1

        return nextIndex
      })

      setIsSwitchingCard(false)
    }, 180)
  }

  function handlePrev() {
    switchCard(-1)
  }

  function handleNext() {
    switchCard(1)
  }

  function shuffleFlashcards() {
    if (cards.length < 2 || isShuffling) return

    setIsShuffling(true)
    setIsSwitchingCard(false)
    setFlipped(false)

    setTimeout(() => {
      const shuffled = [...cards]

      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }

      setCards(shuffled)
      setCurrentIndex(0)
      setIsShuffling(false)
    }, 850)
  }

  function startQuiz() {
    const shuffled = [...cards].sort(() => Math.random() - 0.5)

    setShuffledCards(shuffled)
    setQuizMode(true)
    setQuizFinished(false)
    setQuizIndex(0)
    setUserAnswer("")
    setQuizResult(null)
    setAiFeedback("")
    setAiCorrect(null)
    setCheckingAnswer(false)
    setQuizScore({ correct: 0, total: 0 })
  }

  function nextQuizCard() {
    setUserAnswer("")
    setQuizResult(null)
    setAiFeedback("")
    setAiCorrect(null)
    setCheckingAnswer(false)

    if (quizIndex + 1 < shuffledCards.length) {
      setQuizIndex((i) => i + 1)
    } else {
      setQuizFinished(true)
    }
  }

  if (!loggedIn) {
    return (
      <div className="container">
        <div className="login-box">
          <h1>Flashcard Generator</h1>
          <p>Enter your first name and number ID</p>

          <input
            className="pin-input"
            type="text"
            placeholder="First name..."
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />

          <input
            className="pin-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Number ID..."
            value={numberId}
            onChange={(e) => setNumberId(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />

          {loginError && <p className="login-error">{loginError}</p>}

          <button
            type="button"
            className="generate-btn"
            onClick={handleLogin}
            disabled={loginLoading || createLoading}
          >
            {loginLoading ? "Logging in..." : "Login"}
          </button>

          <button
            type="button"
            className="create-btn"
            onClick={handleCreateAccount}
            disabled={loginLoading || createLoading}
          >
            {createLoading ? "Creating..." : "Create Account"}
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
            type="button"
            className="logout-btn"
            onClick={() => {
              setLoggedIn(false)
              setFirstName("")
              setNumberId("")
              setCards([])
              setNotes("")
              setSavedDecks([])
              setSelectedDeckIds({})
              setActiveDeckName("")
              setQuizMode(false)
              setIsShuffling(false)
              setIsSwitchingCard(false)
            }}
          >
            Logout
          </button>

          <button
            type="button"
            className="delete-account-btn"
            onClick={deleteAccount}
          >
            Delete Account
          </button>
        </div>
      </div>

      <p>Paste your notes below and AI will turn them into flashcards</p>

      {isMobileDevice() && (
        <p className="error">
          Mobile AI generation is disabled to prevent from crashing. Use a
          laptop or desktop to generate new flashcards.
        </p>
      )}

      {savedDecks.length > 0 && (
        <div className="saved-decks">
          <p className="saved-label">Your saved decks:</p>

          <div className="deck-list">
            {getGroupedSavedDecks().map((group) => {
              const selectedId =
                selectedDeckIds[group.key] || String(group.decks[0].id)

              const selectedDeck =
                group.decks.find((deck) => String(deck.id) === String(selectedId)) ||
                group.decks[0]

              return (
                <div className="deck-group" key={group.key}>
                  <p className="deck-title">{group.name}</p>

                  <div className="deck-version-controls">
                    <select
                      className="deck-version-select"
                      value={String(selectedDeck.id)}
                      onChange={(e) => {
                        setSelectedDeckIds((current) => ({
                          ...current,
                          [group.key]: e.target.value
                        }))
                      }}
                    >
                      {group.decks.map((deck) => (
                        <option key={deck.id} value={String(deck.id)}>
                          {getDeckCount(deck)} flashcards
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="deck-btn"
                      onClick={() => loadDeck(selectedDeck)}
                    >
                      Load
                    </button>

                    <button
                      type="button"
                      className="deck-delete-btn"
                      onClick={() => deleteSavedDeck(selectedDeck)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <textarea
        ref={notesRef}
        className="notes-input"
        placeholder="Paste your notes here..."
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()

            if (!loading && notes.trim()) {
              generateFlashcards()
            }
          }
        }}
      />

      <div className="card-count">
        <label>Number of flashcards</label>

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={cardCount}
          onChange={(e) => setCardCount(e.target.value.replace(/\D/g, ""))}
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
            <p className="slow-load">
              ⏳ Taking longer than expected... hang tight!
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        className="generate-btn"
        onClick={generateFlashcards}
        disabled={loading || isMobileDevice()}
      >
        {loading ? "Loading..." : "Generate Flashcards"}
      </button>

      {cards.length > 0 && cards[currentIndex] && (
        <div className={`cards-section ${isShuffling ? "is-shuffling" : ""}`}>
          {activeDeckName && (
            <p className="active-deck-name">📚 {activeDeckName}</p>
          )}

          <p className="card-counter">
            {currentIndex + 1} / {cards.length}
          </p>

          <div
            className={`card ${flipped ? "flipped" : ""} ${
              isShuffling ? "shuffle-animation" : ""
            }`}
            onClick={() =>
              !isShuffling && !isSwitchingCard && setFlipped(!flipped)
            }
          >
            <div className="card-inner">
              <div className="card-front">
                <p>{cards[currentIndex].question}</p>
                <span className="hint">
                  {isShuffling ? "Mixing your deck..." : "Click to reveal answer"}
                </span>
              </div>

              <div className="card-back">
                <p>{cards[currentIndex].answer}</p>
                <span className="hint">Click to see question</span>
              </div>
            </div>
          </div>

          <div className="nav-buttons">
            <button
              type="button"
              className="nav-btn"
              onClick={handlePrev}
              disabled={currentIndex === 0 || isShuffling || isSwitchingCard}
            >
              ← Prev
            </button>

            <button
              type="button"
              className="nav-btn shuffle-btn"
              onClick={shuffleFlashcards}
              disabled={cards.length < 2 || isShuffling || isSwitchingCard}
            >
              {isShuffling ? "🔄 Shuffling..." : "🔀 Shuffle"}
            </button>

            <button
              type="button"
              className="nav-btn"
              onClick={handleNext}
              disabled={
                currentIndex === cards.length - 1 ||
                isShuffling ||
                isSwitchingCard
              }
            >
              Next →
            </button>
          </div>

          <button
            type="button"
            className="quiz-btn"
            onClick={startQuiz}
            disabled={isShuffling || isSwitchingCard}
          >
            ✏️ Try it yourself
          </button>
        </div>
      )}

      {quizMode && (
        <div className="quiz-overlay">
          <div className="quiz-box">
            {quizFinished ? (
              <div className="quiz-finished">
                <p className="quiz-finished-emoji">
                  {quizScore.correct === shuffledCards.length
                    ? "🎉"
                    : quizScore.correct >= shuffledCards.length / 2
                    ? "👍"
                    : "📖"}
                </p>

                <p className="quiz-finished-title">Quiz Complete!</p>

                <p className="quiz-finished-score">
                  You got <strong>{quizScore.correct}</strong> out of{" "}
                  <strong>{shuffledCards.length}</strong> correct
                </p>

                <p className="quiz-finished-pct">
                  {Math.round((quizScore.correct / shuffledCards.length) * 100)}%
                </p>

                <div className="quiz-feedback-btns">
                  <button
                    type="button"
                    className="quiz-correct-btn"
                    onClick={startQuiz}
                  >
                    Try Again
                  </button>

                  <button
                    type="button"
                    className="quiz-wrong-btn"
                    onClick={() => setQuizMode(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="quiz-header">
                  <p className="quiz-counter">
                    {quizIndex + 1} / {shuffledCards.length}
                  </p>

                  <p className="quiz-score">
                    ✅ {quizScore.correct} / {quizScore.total}
                  </p>

                  <button
                    type="button"
                    className="quiz-close"
                    onClick={() => setQuizMode(false)}
                  >
                    ✕
                  </button>
                </div>

                <p className="quiz-question">
                  {shuffledCards[quizIndex]?.question}
                </p>

                {quizResult === null ? (
                  <>
                    <textarea
                      className="quiz-input"
                      placeholder="Type your answer..."
                      value={userAnswer}
                      onChange={(e) => setUserAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()

                          const answer = e.currentTarget.value.trim()

                          if (!checkingAnswer && answer) {
                            checkAnswerWithAI(answer)
                          }
                        }
                      }}
                    />

                    <button
                      type="button"
                      className="quiz-check-btn"
                      onClick={() => checkAnswerWithAI(userAnswer)}
                      disabled={checkingAnswer}
                    >
                      {checkingAnswer ? "Checking..." : "Check with AI"}
                    </button>
                  </>
                ) : (
                  <>
                    <div
                      className={
                        aiCorrect
                          ? "ai-feedback ai-correct"
                          : "ai-feedback ai-wrong"
                      }
                    >
                      <strong>{aiCorrect ? "Correct!" : "Not quite"}</strong>
                      <p>{aiFeedback}</p>
                    </div>

                    <div className="quiz-answer">
                      <p className="quiz-answer-label">Correct Answer:</p>
                      <p>{quizResult}</p>
                    </div>

                    <p className="quiz-your-answer-label">
                      Your Answer: <span>{userAnswer}</span>
                    </p>

                    <div className="quiz-feedback-btns">
                      <button
                        type="button"
                        className="quiz-correct-btn"
                        onClick={nextQuizCard}
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App