import { useState, useRef, useEffect } from "react"
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
  const [slowLoad, setSlowLoad] = useState(false)
  const [aiFeedback, setAiFeedback] = useState(null)
  const [checkingAnswer, setCheckingAnswer] = useState(false)
  const engineRef = useRef(null)

  useEffect(() => {
  if (cards.length > 0) {
    document.body.style.overflowY = "auto"
    document.documentElement.style.overflowY = "auto"
  } else {
    document.body.style.overflowY = "hidden"
    document.documentElement.style.overflowY = "hidden"
  }
  return () => {
    document.body.style.overflowY = "auto"
    document.documentElement.style.overflowY = "auto"
  }
}, [cards])

  async function getEngine() {
    if (engineRef.current) return engineRef.current
    const engine = await webllm.CreateMLCEngine(MODEL, {
      initProgressCallback: (progress) => {
        const pct = Math.round(progress.progress * 100)
        if (pct < 100) {
          setLoadingMessage(`Downloading model... ${pct}%`)
        } else {
          setLoadingMessage("Loading model...")
        }
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
    setLoadingMessage("Preparing...")

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
setLoadingMessage("Loading model...")
await new Promise(r => setTimeout(r, 800))
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

    clearTimeout(slowTimer)
    setSlowLoad(false)
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
    setAiFeedback(null)
    setQuizScore({ correct: 0, total: 0 })
  }

  function nextQuizCard() {
    if (quizIndex + 1 < shuffledCards.length) {
      setQuizIndex(i => i + 1)
      setUserAnswer("")
      setQuizResult(null)
      setAiFeedback(null)
    } else {
      setQuizMode(false)
    }
  }

  async function checkAnswer() {
    if (!userAnswer.trim()) return
    setCheckingAnswer(true)
    setQuizScore(s => ({ ...s, total: s.total + 1 }))

    try {
      const engine = await getEngine()
      const reply = await engine.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You are a helpful quiz evaluator. Evaluate the student's answer compared to the correct answer. Be encouraging, brief (2-3 sentences), and tell them if they got it right, partially right, or wrong and why."
          },
          {
            role: "user",
            content: `Question: ${shuffledCards[quizIndex].question}
Correct Answer: ${shuffledCards[quizIndex].answer}
Student's Answer: ${userAnswer}

Did the student get it right? Give brief feedback.`
          }
        ],
        temperature: 0.7,
        max_tokens: 150
      })

      const feedback = reply.choices[0].message.content
      setAiFeedback(feedback)
      setQuizResult(shuffledCards[quizIndex].answer)

      const isCorrect =
        feedback.toLowerCase().includes("correct") ||
        feedback.toLowerCase().includes("right") ||
        feedback.toLowerCase().includes("great") ||
        feedback.toLowerCase().includes("good job") ||
        feedback.toLowerCase().includes("well done")

      if (isCorrect) {
        setQuizScore(s => ({ ...s, correct: s.correct + 1 }))
      }

    } catch (err) {
      setQuizResult(shuffledCards[quizIndex].answer)
      setAiFeedback("Could not evaluate answer. Check the correct answer above.")
    }

    setCheckingAnswer(false)
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
                  onClick={checkAnswer}
                  disabled={checkingAnswer}
                >
                  {checkingAnswer ? "Checking..." : "Check Answer"}
                </button>
              </>
            ) : (
              <>
                {aiFeedback && (
                  <div className="ai-feedback">
                    <p className="ai-feedback-label">🤖 AI Feedback</p>
                    <p>{aiFeedback}</p>
                  </div>
                )}

                <div className="quiz-answer">
                  <p className="quiz-answer-label">Correct Answer:</p>
                  <p>{quizResult}</p>
                </div>

                <p className="quiz-your-answer-label">Your Answer: <span>{userAnswer}</span></p>

                <button className="quiz-next-btn" onClick={nextQuizCard}>
                  {quizIndex + 1 < shuffledCards.length ? "Next Question →" : "Finish Quiz"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App