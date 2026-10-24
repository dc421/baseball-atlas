# Export your rating model's results for the atlas.
#
#   Rscript scripts/export_ratings.R ["~/Documents/Baseball Ratings 2023.R"]
#
# Runs the ratings script as-is, top to bottom, stopping right after the Hall of Fame
# models (the Showdown section and everything below it is skipped), then writes:
#   data/source/ratings_seasons.csv   one row per player-season: rating, year rank, tools
#   data/source/ratings_players.csv   one row per player: peak-weighted rating, ranks, HOF odds
# The ratings script itself is never modified. Takes a while: every *_mr column is an optimisation.

.args <- commandArgs(trailingOnly = TRUE)
.src <- if (length(.args)) path.expand(.args[1]) else path.expand("~/Documents/Baseball Ratings 2023.R")
.out <- normalizePath(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE)[1])), "..", "data", "source"))
.stop_at <- "should_hof_pred=predict"  # last statement we need (player_ratings gets its HOF columns)

.exprs <- parse(.src, keep.source = TRUE)
.text <- vapply(attr(.exprs, "srcref"), function(s) paste(as.character(s), collapse = "\n"), "")
.last <- which(grepl(.stop_at, .text, fixed = TRUE))[1]
if (is.na(.last)) stop("Couldn't find '", .stop_at, "' in ", .src, ". Has the HOF block been renamed?")
cat("Running", .last, "of", length(.exprs), "statements from", .src, "\n")
.t0 <- Sys.time()
for (.i in seq_len(.last)) {
  # rm(list=ls()) at the top of the script leaves dot-names alone, so .src/.out/.i survive
  .v <- withVisible(eval(.exprs[[.i]], envir = globalenv()))
  if (.i %% 50 == 0) cat(sprintf("  %d/%d  (%.1f min)\n", .i, .last, as.numeric(Sys.time() - .t0, units = "mins")))
}

# Same scale as player_ratings: hitter net -.005, pitcher (net-.0175)/3.5, 1800s discount on positives
era <- function(x, y) x * ifelse(x > 0, plogis((y - 1870) / 10 - .7)^2, 1)
num <- function(x) round(as.numeric(x), 6)

hit_seasons <- Batting %>%
  dplyr::transmute(playerID, name = name_common, yearID, teamID, lgID, POS, kind = "H",
                   G, AB, PA = AB + dplyr::coalesce(BB, 0) + dplyr::coalesce(HBP, 0), BFP = NA_real_, year_rank,
                   score = num(era(proj_WAR_ovr_net - .005, yearID)),
                   proj_WAR_G = num(proj_WAR_ovr), WAR_G = num(WAR_G),
                   hit_tool = num(hit_tool), power = num(power), speed = num(speed),
                   fielding = num(fielding_score), K_plus = NA_real_, BB_plus = NA_real_, rp_score = NA_real_)
pit_seasons <- Pitching %>%
  dplyr::transmute(playerID, name = name_common, yearID, teamID, lgID, POS, kind = "P",
                   G, AB = NA_real_, PA = NA_real_, BFP, year_rank,
                   score = num(era((proj_WAR_ovr_net - .0175) / 3.5, yearID)),
                   proj_WAR_G = num(proj_WAR_ovr), WAR_G = num(WAR_G),
                   hit_tool = NA_real_, power = NA_real_, speed = NA_real_, fielding = NA_real_,
                   K_plus = num(SO_BFP_plus_mr), BB_plus = num(BB_BFP_plus_mr), rp_score = num(proj_WAR_BFP_net))
seasons <- dplyr::bind_rows(hit_seasons, pit_seasons) %>% dplyr::filter(is.finite(score)) %>% dplyr::arrange(yearID, kind, year_rank)
write.csv(seasons, file.path(.out, "ratings_seasons.csv"), row.names = FALSE, na = "")

career_WAR <- Batting %>% group_by(playerID) %>% dplyr::summarise(WAR = sum(fWAR + bWAR, na.rm = TRUE) / 2) %>% ungroup() %>%
  full_join(Pitching %>% group_by(playerID) %>% dplyr::summarise(pWAR = sum(fWAR + bWAR, na.rm = TRUE) / 2) %>% ungroup()) %>%
  dplyr::mutate(WAR = ifelse(is.na(WAR), 0, WAR) + ifelse(is.na(pWAR), 0, pWAR)) %>% dplyr::select(playerID, WAR)
players <- player_ratings %>%
  arrange(-proj_WAR_ovr_net) %>% distinct(playerID, .keep_all = TRUE) %>%
  dplyr::mutate(rk_ovr = seq_len(n())) %>% group_by(POS) %>% dplyr::mutate(pos_rk = seq_len(n())) %>% ungroup() %>%
  left_join(career_WAR, by = "playerID") %>%
  dplyr::transmute(playerID, name = name_common, POS, peak_year = yearID, teamID, rating = num(proj_WAR_ovr_net),
                   rk_ovr, pos_rk, WAR = round(WAR, 1), hof, hof_pred = num(hof_pred), should_hof_pred = num(should_hof_pred))
write.csv(players, file.path(.out, "ratings_players.csv"), row.names = FALSE, na = "")

cat(sprintf("\nwrote %d seasons and %d players to %s (%.1f min)\n", nrow(seasons), nrow(players), .out,
            as.numeric(Sys.time() - .t0, units = "mins")))
