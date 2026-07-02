#!/usr/bin/env Rscript
# rcube3d.R - NxN Rubik's Cube console simulator in R
# Controls: move tokens (U D F B L R M E S, append ' for CCW or 2 for double),
#           scramble, solve, reset, quit/q, help

ANSI <- list(
  U = "\033[47m",       # white bg
  D = "\033[43m",       # yellow bg
  F = "\033[42m",       # green bg
  B = "\033[44m",       # blue bg
  L = "\033[48;5;208m", # orange bg (256-color)
  R = "\033[41m",       # red bg
  RESET = "\033[0m"
)

FACES <- c("U", "D", "F", "B", "L", "R")

# ---------------------------------------------------------------------------
# Cube construction
# ---------------------------------------------------------------------------
cube_new <- function(n = 3) {
  faces <- setNames(
    lapply(FACES, function(f) matrix(f, nrow = n, ncol = n)),
    FACES)
  list(faces = faces, n = n, move_log = character(0))
}

# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------
rotate_cw <- function(mat) t(mat[nrow(mat):1, , drop = FALSE])

colored_cell <- function(ch) {
  col <- ANSI[[ch]]
  if (is.null(col)) col <- ""
  paste0(col, "  ", ANSI$RESET)
}

cube_print <- function(cube, move = "") {
  if (nchar(move) > 0)
    cat(sprintf("\nPerformed move: %s\n", move))
  else
    cat("\nCube state:\n")
  n <- cube$n
  pad <- paste(rep("  ", n), collapse = "")   # n*2 spaces

  # U face
  for (i in seq_len(n)) {
    cat(pad)
    for (j in seq_len(n)) cat(colored_cell(cube$faces$U[i, j]))
    cat("\n")
  }
  # Middle band: L F R B
  for (i in seq_len(n)) {
    for (face in c("L", "F", "R", "B"))
      for (j in seq_len(n)) cat(colored_cell(cube$faces[[face]][i, j]))
    cat("\n")
  }
  # D face
  for (i in seq_len(n)) {
    cat(pad)
    for (j in seq_len(n)) cat(colored_cell(cube$faces$D[i, j]))
    cat("\n")
  }
  cat(strrep("-", 30), "\n")
}

# ---------------------------------------------------------------------------
# Face moves (correct index-cycling, matches cube_engine.py geometry)
# ---------------------------------------------------------------------------
move_U <- function(cube) {
  f <- cube$faces
  f$U <- rotate_cw(f$U)
  temp    <- f$F[1, ]
  f$F[1, ] <- f$R[1, ]
  f$R[1, ] <- f$B[1, ]
  f$B[1, ] <- f$L[1, ]
  f$L[1, ] <- temp
  cube$faces <- f; cube
}

move_D <- function(cube) {
  n <- cube$n; f <- cube$faces
  f$D <- rotate_cw(f$D)
  temp      <- f$F[n, ]
  f$F[n, ] <- f$L[n, ]
  f$L[n, ] <- f$B[n, ]
  f$B[n, ] <- f$R[n, ]
  f$R[n, ] <- temp
  cube$faces <- f; cube
}

move_F <- function(cube) {
  n <- cube$n; f <- cube$faces
  f$F <- rotate_cw(f$F)
  temp    <- f$U[n, ]
  f$U[n, ] <- rev(f$L[, n])
  f$L[, n] <- f$D[1, ]
  f$D[1, ] <- rev(f$R[, 1])
  f$R[, 1] <- temp
  cube$faces <- f; cube
}

move_B <- function(cube) {
  n <- cube$n; f <- cube$faces
  f$B <- rotate_cw(f$B)
  temp    <- f$U[1, ]
  f$U[1, ] <- rev(f$R[, n])
  f$R[, n] <- f$D[n, ]
  f$D[n, ] <- rev(f$L[, 1])
  f$L[, 1] <- temp
  cube$faces <- f; cube
}

move_L <- function(cube) {
  n <- cube$n; f <- cube$faces
  f$L <- rotate_cw(f$L)
  temp    <- f$U[, 1]
  f$U[, 1]    <- rev(f$B[, n])
  f$B[n:1, n] <- f$D[, 1]
  f$D[, 1]    <- f$F[, 1]
  f$F[, 1]    <- temp
  cube$faces <- f; cube
}

move_R <- function(cube) {
  n <- cube$n; f <- cube$faces
  f$R <- rotate_cw(f$R)
  temp    <- f$U[, n]
  f$U[, n]    <- f$F[, n]
  f$F[, n]    <- f$D[, n]
  f$D[, n]    <- rev(f$B[, 1])
  f$B[n:1, 1] <- temp
  cube$faces <- f; cube
}

move_M <- function(cube) {
  n <- cube$n
  if (n %% 2 == 0) stop("M requires odd cube size")
  m <- (n + 1L) %/% 2L; f <- cube$faces
  temp    <- f$U[, m]
  f$U[, m] <- f$F[, m]
  f$F[, m] <- f$D[, m]
  f$D[, m] <- f$B[, m]
  f$B[, m] <- temp
  cube$faces <- f; cube
}

move_E <- function(cube) {
  n <- cube$n
  if (n %% 2 == 0) stop("E requires odd cube size")
  m <- (n + 1L) %/% 2L; f <- cube$faces
  temp    <- f$F[m, ]
  f$F[m, ] <- f$R[m, ]
  f$R[m, ] <- f$B[m, ]
  f$B[m, ] <- f$L[m, ]
  f$L[m, ] <- temp
  cube$faces <- f; cube
}

move_S <- function(cube) {
  n <- cube$n
  if (n %% 2 == 0) stop("S requires odd cube size")
  m <- (n + 1L) %/% 2L; f <- cube$faces
  temp       <- f$U[n, m]
  f$U[n, m]  <- f$L[m, n]
  f$L[m, n]  <- f$D[1, m]
  f$D[1, m]  <- f$R[m, 1]
  f$R[m, 1]  <- temp
  cube$faces <- f; cube
}

# ---------------------------------------------------------------------------
# Generic apply_move (token like "R", "R'", "R2")
# ---------------------------------------------------------------------------
move_fns <- list(U=move_U, D=move_D, F=move_F, B=move_B,
                 L=move_L, R=move_R, M=move_M, E=move_E, S=move_S)

apply_move_once <- function(cube, base) {
  fn <- move_fns[[base]]
  if (is.null(fn)) stop(paste("Unknown move base:", base))
  fn(cube)
}

apply_move <- function(cube, token) {
  if (endsWith(token, "'")) {
    base <- substr(token, 1, nchar(token) - 1)
    for (i in 1:3) cube <- apply_move_once(cube, base)
  } else if (endsWith(token, "2")) {
    base <- substr(token, 1, nchar(token) - 1)
    for (i in 1:2) cube <- apply_move_once(cube, base)
  } else {
    cube <- apply_move_once(cube, token)
  }
  cube$move_log <- c(cube$move_log, token)
  cube
}

apply_moves <- function(cube, tokens) {
  for (tok in tokens) cube <- apply_move(cube, tok)
  cube
}

# ---------------------------------------------------------------------------
# Scramble
# ---------------------------------------------------------------------------
scramble <- function(cube, n_moves = 25) {
  pool <- unlist(lapply(c("U","D","F","B","L","R"),
                        function(f) c(f, paste0(f,"'"), paste0(f,"2"))))
  seq <- sample(pool, n_moves, replace = TRUE)
  cube <- apply_moves(cube, seq)
  cat(sprintf("Scrambled with %d moves: %s\n", n_moves, paste(seq, collapse=" ")))
  cube
}

# ---------------------------------------------------------------------------
# Solve (delegates to Python solver.py in the same directory)
# ---------------------------------------------------------------------------
solve_cube <- function(cube) {
  script_dir <- tryCatch(
    dirname(sys.frame(1)$ofile),
    error = function(e) "."
  )
  py_lines <- c(
    "import sys, os",
    paste0("sys.path.insert(0, '", script_dir, "')"),
    "from cube_engine import Cube",
    "from solver import solve",
    paste0("c = Cube(", cube$n, ")"),
    unlist(lapply(FACES, function(face) {
      m <- cube$faces[[face]]
      unlist(lapply(seq_len(cube$n) - 1, function(i)
        lapply(seq_len(cube$n) - 1, function(j)
          sprintf("c.faces['%s'][%d][%d] = '%s'", face, i, j, m[i+1, j+1]))))
    })),
    "sol = solve(c)",
    "print(' '.join(sol))"
  )
  tmpf <- tempfile(fileext = ".py")
  writeLines(py_lines, tmpf)
  on.exit(unlink(tmpf))
  out <- tryCatch(
    system2("python3", tmpf, stdout = TRUE, stderr = FALSE),
    error = function(e) character(0)
  )
  if (length(out) == 0) { cat("Solve failed (Python solver unavailable?).\n"); return(cube) }
  sol_moves <- strsplit(trimws(tail(out, 1)), "\\s+")[[1]]
  cube <- apply_moves(cube, sol_moves)
  cat(sprintf("Solved in %d moves: %s\n", length(sol_moves), paste(sol_moves, collapse=" ")))
  cube
}

# ---------------------------------------------------------------------------
# is_solved check
# ---------------------------------------------------------------------------
is_solved <- function(cube) {
  all(sapply(FACES, function(f) all(cube$faces[[f]] == f)))
}

# ---------------------------------------------------------------------------
# Interactive main loop
# ---------------------------------------------------------------------------
main <- function(n = 3) {
  cube <- cube_new(n)
  cat(sprintf("Rubik's Cube %dx%d - R console version\n", n, n))
  cat("Moves: U D F B L R M E S (append ' for CCW, 2 for double)\n")
  cat("Commands: scramble, solve, reset, quit (q), help\n")
  cube_print(cube)

  repeat {
    cat("> ")
    line <- tryCatch(readLines(con = stdin(), n = 1), error = function(e) "quit")
    if (length(line) == 0) line <- "quit"
    line <- trimws(line)

    if (line %in% c("quit", "q", "exit")) {
      cat("Bye!\n"); break
    } else if (line == "help") {
      cat("Move tokens: U D F B L R M E S with optional ' (CCW) or 2 (double)\n")
      cat("  e.g. R, R', R2, U2, F'\n")
      cat("scramble  - apply 25 random moves\n")
      cat("solve     - solve the cube using Python solver (2x2 or 3x3 only)\n")
      cat("reset     - reset to solved state\n")
      cat("print     - print current state\n")
      cat("quit / q  - exit\n")
    } else if (line == "scramble") {
      cube <- scramble(cube)
      cube_print(cube)
    } else if (line == "solve") {
      if (!cube$n %in% c(2, 3)) {
        cat("Solver only supports 2x2 and 3x3 cubes.\n")
      } else {
        cube <- solve_cube(cube)
        cube_print(cube)
      }
    } else if (line == "reset") {
      cube <- cube_new(cube$n)
      cat("Reset to solved state.\n")
      cube_print(cube)
    } else if (line == "print") {
      cube_print(cube)
    } else if (nchar(line) == 0) {
      next
    } else {
      # Try to apply as move token(s)
      tokens <- strsplit(line, "\\s+")[[1]]
      ok <- TRUE
      for (tok in tokens) {
        cube <- tryCatch({
          cube <- apply_move(cube, tok)
          cube_print(cube, move = tok)
          cube
        }, error = function(e) {
          cat(sprintf("Unknown move '%s'. Type 'help' for commands.\n", tok))
          ok <<- FALSE
          cube
        })
        if (!ok) break
      }
    }
  }
}

# Run main if executed as a script
args <- commandArgs(trailingOnly = TRUE)
n_arg <- if (length(args) >= 1) suppressWarnings(as.integer(args[1])) else NA_integer_
n_val <- if (!is.na(n_arg) && n_arg >= 2) n_arg else 3L
main(n_val)
