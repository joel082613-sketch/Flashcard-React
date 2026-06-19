import { useState, useRef } from "react"
import { pipeline } from "@huggingface/transformers"
import "./App.css"

function App() {
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState("")
  const [error, setError] = useState("")
  const [cards, setCards] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [cardCount, setCardCount] = useState("8")
  const generatorRef = useRef(null)

  async function getGenerator() {
    if (generatorRef.current) return generatorRef.current

    const generator = await pipeline(
      "text-generation",
      "onnx-community/gemma-3-1b-it-ONNX",
      {
        dtype: "q8",
        progress_callback: (progress) => {
          if (progress.status === "progress") {
            setLoadingMessage(`Downloading model: ${Math.round(progress.progress)}%`)
          }
        }
      }
    )

    generatorRef.current = generator
    return generator
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
      const generator = await getGenerator()
      let allCards = []
      let attempts = 0

      while (allCards.length < needed && attempts < 3) {
        const remaining = needed - allCards.length
        setLoadingMessage(`Generating flashcards... (${allCards.length}/${needed})`)

        const messages = [
          {
            role: "system",
            content: `You are a flashcard generator. Return ONLY a JSON array with no extra text.
            Each item must have a "question" and "answer" field. Example:
            [{"question": "What is X?", "answer": "X is..."}]`
          },
          {
            role: "user",
            content: `Generate EXACTLY ${remaining} flashcards from these notes. Return exactly ${remaining} items in the array, no more no less: ${notes}`
          }
        ]

        const output = await generator(messages, { max_new_tokens: 1000 })
        const text = output[0].generated_text.at(-1).content
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
        </div>
      )}
    </div>
  )
}

export default App