import { useState, useRef } from "react"
import * as webllm from "@mlc-ai/web-llm"
import "./App.css"

const MODEL = "Mistral-7B-Instruct-v0.3-q4f16_1-MLC"

function App() {
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState("")
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
  const engineRef = useRef(null)

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
    setLoadingMessage("Loading AI model...")

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

    } catch (err) {
      setError("Something went wrong: " + err.message)
    }

    setLoading(false)
    setLoadingMessage("")
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

  return (
    <div className="container">
      <h1>Flashcard Generator</h1>
      <p>Paste your notes below and AI will turn them into flashcards</p>

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
      {loadingMessage && <p className="loading-msg">{loadingMessage}</p>}

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