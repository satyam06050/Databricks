# Databricks notebook source
# MAGIC %md
# MAGIC # Mini-Project 1 — Data Exploration (NYC Taxi)
# MAGIC ### Databricks + Snowflake 70-Hour Programme | ExcelR × KIIT
# MAGIC
# MAGIC **Name:** Satyam Kumar  
# MAGIC **Roll number:** ____2328120___________________  
# MAGIC **Date started:** _______6/8/2026________________
# MAGIC
# MAGIC ---
# MAGIC **Before you start:**
# MAGIC 1. Set `SEED` in Cell 2 to the **last 4 digits of your roll number**. Do not change it later.
# MAGIC 2. Run every cell top to bottom. Never skip Cell 2 — it builds *your* copy of the data.
# MAGIC 3. Fill in every `# TODO`. Delete nothing.
# MAGIC 4. Write your answer as a short comment under each result. A number with no sentence earns half marks.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Cell 1 — Imports and sanity check
# MAGIC You'll know it worked when the schema prints 6 columns and the count is a five-digit number.

# COMMAND ----------

from pyspark.sql import functions as F

base = spark.table("samples.nyctaxi.trips")
base.printSchema()
print("Rows in the shared source table:", base.count())
display(base.limit(5))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Cell 2 — Build YOUR dataset  ⚠️ EDIT THE SEED, CHANGE NOTHING ELSE
# MAGIC
# MAGIC This cell deterministically produces a variant of the source data that belongs to you alone.
# MAGIC Same seed ⇒ same rows, every single time. Different seed ⇒ different answers.
# MAGIC
# MAGIC **You'll know it worked when:** the printed row count is close to, but not equal to, the count
# MAGIC from Cell 1, and it ends with your own digits — nobody else in the room will print the same number.

# COMMAND ----------

# ============================================================
# EDIT THIS LINE ONLY
SEED = 8120          # <-- last 4 digits of your roll number, e.g. SEED = 1742
# ============================================================

assert SEED != 0000, "Set SEED to the last 4 digits of your roll number before running."

_keyed = base.withColumn(
    "row_key",
    F.xxhash64(
        F.col("tpep_pickup_datetime").cast("string"),
        F.col("tpep_dropoff_datetime").cast("string"),
        F.col("trip_distance").cast("string"),
        F.col("fare_amount").cast("string"),
        F.col("pickup_zip").cast("string"),
        F.col("dropoff_zip").cast("string"),
        F.lit(SEED).cast("string"),
    ),
)

# 1) keep a seeded subset of the rows
_sampled = _keyed.filter(F.pmod(F.col("row_key"), F.lit(100)) >= 12)

# 2) blank out the fare on a small seeded set of rows
_nulled = _sampled.withColumn(
    "fare_amount",
    F.when(F.pmod(F.col("row_key"), F.lit(97)) == 0, F.lit(None).cast("double"))
     .otherwise(F.col("fare_amount")),
)

# 3) re-insert a small seeded set of rows a second time
_dupes = _nulled.filter(F.pmod(F.col("row_key"), F.lit(67)) == 0)

trips = _nulled.unionByName(_dupes).drop("row_key")
trips.createOrReplaceTempView("my_trips")

print("SEED =", SEED)
print("Rows in MY dataset:", trips.count())

# COMMAND ----------

# MAGIC %md
# MAGIC # PART A — Profile your data
# MAGIC *(unlocks after Day 6 — DataFrame API)*
# MAGIC
# MAGIC Goal: describe what you have been given before you touch it. Do not clean anything yet.

# COMMAND ----------

# A1. How many rows and how many columns are in YOUR dataset?
# TODO
# Answer:  rows(19614),columns(6) 
# A1
print("Rows:", trips.count())
print("Columns:", len(trips.columns))

# Comment: The dataset contains 19,614 rows and 6 columns.

# COMMAND ----------

# A2. Print the schema. In a comment, write the data type of every column in plain English,
#     e.g. "fare_amount is a double — money in US dollars".
# TODO
# Answer:# A2

# tpep_pickup_datetime is a timestamp — the date and time when the taxi trip started.
# tpep_dropoff_datetime is a timestamp — the date and time when the taxi trip ended.
# trip_distance is a double — the distance travelled by the taxi in miles.
# fare_amount is a double — the fare charged for the trip in US dollars.
# pickup_zip is an integer — the ZIP code of the pickup location.
# dropoff_zip is an integer — the ZIP code of the drop-off location.
# A2
trips.printSchema()

# COMMAND ----------

# A3. What is the earliest and the latest pickup timestamp in your data?
#     Hint: F.min(...) and F.max(...) inside .agg()
# TODO
# Answer: the data covers 2016-01-01 00:11:29 to 2016-02-29 23:51:20
# A3
result = trips.agg(
    F.min("tpep_pickup_datetime").alias("earliest_pickup"),
    F.max("tpep_pickup_datetime").alias("latest_pickup")
)

display(result)

# Comment: The dataset covers the period from January 1, 2016 to February 29, 2016 based on pickup timestamps.

# COMMAND ----------

# A4. How many rows are EXACT duplicates (every column identical to another row)?
#     Hint: compare .count() with .dropDuplicates().count()
# TODO
# Answer: 284 duplicate rows
# A4
duplicate_count = (
    trips.groupBy(trips.columns)
         .count()
         .filter(F.col("count") > 1)
         .agg(F.sum(F.col("count") - 1).alias("duplicate_rows"))
         .first()["duplicate_rows"]
)

print("Exact duplicate rows:", duplicate_count)

# Comment: There are 284 rows that are duplicate occurrences of another identical row.

# COMMAND ----------

# A5. How many NULLs are there in each column?
#     Hint: build one .agg() with F.count(F.when(F.col(c).isNull(), c)).alias(c) for each column,
#     or loop over trips.columns.
# TODO
# Answer: tpep_pickup_datetime: 0, tpep_dropoff_datetime: 0, trip_distance: 0, fare_amount: 205, pickup_zip: 0, dropoff_zip: 0
# A5
null_counts = trips.select([
    F.sum(F.col(c).isNull().cast("int")).alias(c)
    for c in trips.columns
])

display(null_counts)

# COMMAND ----------

# A6. Count the rows that look wrong even though they are not null:
#     (a) fare_amount <= 0
#     (b) trip_distance <= 0
#     (c) dropoff timestamp is earlier than or equal to the pickup timestamp
# TODO
# Answer: (a) 10  (b) 63  (c) 1
# A6.1
fare_wrong = trips.filter(
    F.col("fare_amount").isNotNull() &
    (F.col("fare_amount") <= 0)
).count()

print("fare_amount <= 0:", fare_wrong)

# Comment: There are 10 non-NULL rows with a fare amount less than or equal to zero.

# A6.2
distance_wrong = trips.filter(
    F.col("trip_distance").isNotNull() &
    (F.col("trip_distance") <= 0)
).count()

print("trip_distance <= 0:", distance_wrong)

# Comment: There are 63 non-NULL rows with a trip distance less than or equal to zero.

# A6.3
time_wrong = trips.filter(
    F.col("tpep_pickup_datetime").isNotNull() &
    F.col("tpep_dropoff_datetime").isNotNull() &
    (F.col("tpep_dropoff_datetime") <= F.col("tpep_pickup_datetime"))
).count()

print("dropoff <= pickup:", time_wrong)

# Comment: There is 1 non-NULL row where the drop-off time is at or before the pickup time.

# COMMAND ----------

# MAGIC %md
# MAGIC # PART B — Clean your data
# MAGIC *(unlocks after Day 7 — transformations)*
# MAGIC
# MAGIC Apply the five rules **in this order** and record how many rows survive each step.
# MAGIC This is your data-quality funnel and it is worth marks on its own.
# MAGIC
# MAGIC | Step | Rule | Rows after |
# MAGIC |---|---|---|
# MAGIC | 0 | raw (`trips`) | |
# MAGIC | 1 | drop exact duplicates | |
# MAGIC | 2 | drop rows where `fare_amount` is NULL | |
# MAGIC | 3 | drop rows where `fare_amount <= 0` | |
# MAGIC | 4 | drop rows where `trip_distance <= 0` | |
# MAGIC | 5 | drop rows where dropoff <= pickup | |
# MAGIC
# MAGIC Call the final result `clean` and register it as a temp view called `my_clean`.

# COMMAND ----------

# TODO — build `clean` step by step and print the count after each step.

# clean = ...
# clean.createOrReplaceTempView("my_clean")
# Step 0 — raw dataset
clean = trips
print("Step 0 - Raw:", clean.count())

# Step 1 — drop exact duplicate rows
clean = clean.dropDuplicates()
print("Step 1 - Drop duplicates:", clean.count())

# Step 2 — drop rows where fare_amount is NULL
clean = clean.filter(F.col("fare_amount").isNotNull())
print("Step 2 - Drop NULL fares:", clean.count())

# Step 3 — drop rows where fare_amount <= 0
clean = clean.filter(F.col("fare_amount") > 0)
print("Step 3 - Drop invalid fares:", clean.count())

# Step 4 — drop rows where trip_distance <= 0
clean = clean.filter(F.col("trip_distance") > 0)
print("Step 4 - Drop invalid distances:", clean.count())

# Step 5 — drop rows where dropoff is at or before pickup
clean = clean.filter(
    F.col("tpep_dropoff_datetime") > F.col("tpep_pickup_datetime")
)
print("Step 5 - Drop invalid timestamps:", clean.count())

# Register final clean dataset
clean.createOrReplaceTempView("my_clean")

# COMMAND ----------

# MAGIC %md
# MAGIC **B7 (written, 3–4 sentences).** For each of the five rules, say in one line *why* a real analyst
# MAGIC would drop those rows — and name one rule you think is arguable, and what you would do instead.
# MAGIC Write your answer in the cell below.

# COMMAND ----------

# MAGIC %md
# MAGIC *Your answer here:*
# MAGIC Exact duplicate rows are removed because they can cause the same trip to be counted more than once. Rows with a NULL fare are removed because fare is required for reliable fare-based analysis. Rows with non-positive fares or distances are removed because they represent invalid or impossible trip measurements. Rows where drop-off occurs at or before pickup are removed because they represent an invalid trip duration.
# MAGIC
# MAGIC The arguable rule is dropping rows with `trip_distance <= 0`, because a zero distance could occasionally represent a legitimate trip such as a very short movement or a measurement issue. Instead of automatically dropping these rows, I would investigate them and, if possible, validate them against trip duration or location data before deciding whether to exclude them.
# MAGIC

# COMMAND ----------

# MAGIC %md
# MAGIC # PART C — Business questions
# MAGIC *(unlocks after Day 7)*
# MAGIC
# MAGIC Use `clean` (or the `my_clean` view) for everything below. You may answer in PySpark or in `%sql` —
# MAGIC use at least one of each somewhere in this section.

# COMMAND ----------

# C1. Headline numbers: total trips, total fare collected, average fare, average trip distance.
#     Round money to 2 decimals and distance to 3.
# TODO
# Answer: 19,072 total trips, $234,481.53 total fare collected, $12.29 average fare, 2.852 miles average trip distance
# C1 — Headline numbers

c1 = clean.agg(
    F.count("*").alias("total_trips"),
    F.sum("fare_amount").alias("total_fare_collected"),
    F.avg("fare_amount").alias("average_fare"),
    F.avg("trip_distance").alias("average_trip_distance")
)

display(
    c1.select(
        "total_trips",
        F.round("total_fare_collected", 2).alias("total_fare_collected"),
        F.round("average_fare", 2).alias("average_fare"),
        F.round("average_trip_distance", 3).alias("average_trip_distance")
    )
)

# COMMAND ----------

# C2. Which HOUR OF THE DAY has the most pickups? Show all 24 hours ordered by trip count.
#     Hint: F.hour("tpep_pickup_datetime")
# TODO
# Answer: busiest hour is 18 (6 PM) with 1,261 trips
# C2 — Pickups by hour

hourly_pickups = (
    clean
    .withColumn("pickup_hour", F.hour("tpep_pickup_datetime"))
    .groupBy("pickup_hour")
    .count()
    .orderBy(F.desc("count"))
)

display(hourly_pickups)

# COMMAND ----------

# C3. Top 5 pickup_zip values by number of trips. For each, also show average fare and average distance.
# TODO
# Answer: Top 5 pickup ZIPs are 10001 (1,079 trips), 10003 (1,021 trips), 10011 (985 trips), 10021 (901 trips), and 10018 (875 trips)
# C3 — Five busiest pickup ZIP codes

top_zips = (
    clean
    .groupBy("pickup_zip")
    .agg(
        F.count("*").alias("trip_count"),
        F.avg("fare_amount").alias("average_fare"),
        F.avg("trip_distance").alias("average_distance")
    )
    .orderBy(F.desc("trip_count"))
    .limit(5)
    .select(
        "pickup_zip",
        "trip_count",
        F.round("average_fare", 2).alias("average_fare"),
        F.round("average_distance", 3).alias("average_distance")
    )
)

display(top_zips)

# COMMAND ----------

# MAGIC %sql
# MAGIC -- C4. Create a column `fare_per_mile` = fare_amount / trip_distance.
# MAGIC --     Which 10 pickup zips have the HIGHEST average fare per mile,
# MAGIC --     counting only zips with at least 50 trips?
# MAGIC --     Hint: .groupBy(...).agg(...) then .filter(F.col("trips") >= 50)
# MAGIC -- TODO
# MAGIC -- Answer: ZIP code 10003 has the highest average fare per mile at $7.86 across 1,021 trips ZIP code 10003 has the highest average fare per mile at $7.86 across 1,021 trips
# MAGIC
# MAGIC SELECT
# MAGIC     pickup_zip,
# MAGIC     COUNT(*) AS trip_count,
# MAGIC     ROUND(AVG(fare_amount / trip_distance), 2) AS avg_fare_per_mile
# MAGIC FROM my_clean
# MAGIC GROUP BY pickup_zip
# MAGIC HAVING COUNT(*) >= 50
# MAGIC ORDER BY avg_fare_per_mile DESC
# MAGIC LIMIT 10;

# COMMAND ----------

# C5. Create a column `duration_min` = (dropoff - pickup) in minutes.
#     Hint: (F.unix_timestamp("tpep_dropoff_datetime") - F.unix_timestamp("tpep_pickup_datetime")) / 60
#     (a) What is the average trip duration?
#     (b) Which DAY OF THE WEEK has the most trips? Hint: F.date_format(col, "EEEE")
# TODO
# Answer: (a) 15 minutes   (b) Friday (3,109 trips)

# C5 — Add duration_min

clean_with_duration = clean.withColumn(
    "duration_min",
    (
        F.unix_timestamp("tpep_dropoff_datetime")
        - F.unix_timestamp("tpep_pickup_datetime")
    ) / 60
)

avg_duration = clean_with_duration.agg(
    F.avg("duration_min").alias("average_duration_min")
)

display(
    avg_duration.select(
        F.round("average_duration_min", 2).alias("average_duration_min")
    )
)


# C5(b) — Trips by day of week

day_counts = (
    clean_with_duration
    .withColumn("day_of_week", F.date_format("tpep_pickup_datetime", "EEEE"))
    .groupBy("day_of_week")
    .count()
    .orderBy(F.desc("count"))
)

display(day_counts)

# COMMAND ----------

# C6. Show the single longest trip by distance, and the single most expensive trip by fare.
#     Print the full row for each.
# TODO
# Answer: Longest trip is 189.1 miles; most expensive trip cost $800.00

# C6(a) — Longest trip by distance

longest_trip = clean.orderBy(
    F.desc("trip_distance")
).limit(1)

display(longest_trip)

# C6(b) — Most expensive trip by fare

most_expensive_trip = clean.orderBy(
    F.desc("fare_amount")
).limit(1)

display(most_expensive_trip)

# COMMAND ----------

# MAGIC %md
# MAGIC # PART D — Your own question

# COMMAND ----------

# D1
# My question:
# Which pickup ZIP codes have the highest average trip distance, considering only ZIP codes with at least 50 trips?

d1 = (
    clean
    .groupBy("pickup_zip")
    .agg(
        F.count("*").alias("trip_count"),
        F.avg("trip_distance").alias("avg_trip_distance")
    )
    .filter(F.col("trip_count") >= 50)
    .orderBy(F.desc("avg_trip_distance"))
    .limit(10)
)

display(
    d1.select(
        "pickup_zip",
        "trip_count",
        F.round("avg_trip_distance", 3).alias("avg_trip_distance")
    )
)


# What I found:

ZIP code 11422 has the highest average trip distance at 15.825 miles across 360 trips, followed by 11371 at 9.620 miles across 425 trips. The results show that some pickup areas generate substantially longer trips than others. A taxi company could use this information to position drivers and vehicles more effectively in areas that tend to generate longer-distance, potentially higher-value rides.


# COMMAND ----------

# MAGIC %md
# MAGIC # PART E — Submission signature
# MAGIC
# MAGIC Run the cell below **exactly as written** after `clean` exists. Copy the printed block into your
# MAGIC findings summary. It is the proof that these numbers came from your own dataset.

# COMMAND ----------

sig = clean.select(
    F.pmod(
        F.xxhash64(
            F.col("tpep_pickup_datetime").cast("string"),
            F.col("tpep_dropoff_datetime").cast("string"),
            F.col("trip_distance").cast("string"),
            F.col("fare_amount").cast("string"),
            F.col("pickup_zip").cast("string"),
            F.col("dropoff_zip").cast("string"),
        ),
        F.lit(1000003),
    ).alias("h")
).agg(
    F.count("*").alias("clean_rows"),
    F.sum("h").alias("dataset_signature"),
).collect()[0]

totals = clean.agg(
    F.round(F.sum("fare_amount"), 2).alias("total_fare"),
    F.round(F.avg("trip_distance"), 4).alias("avg_distance"),
).collect()[0]

print("=========== MINI-PROJECT 1 SIGNATURE ===========")
print("SEED              :", SEED)
print("CLEAN ROWS        :", sig["clean_rows"])
print("DATASET SIGNATURE :", sig["dataset_signature"])
print("TOTAL FARE        :", totals["total_fare"])
print("AVG DISTANCE      :", totals["avg_distance"])
print("================================================")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Finally
# MAGIC 1. Open **Query History** (left sidebar), find one of your `groupBy` queries, open its **Query Profile**
# MAGIC    and take a screenshot showing rows read and time taken. Submit it with your notebook.
# MAGIC 2. Export this notebook: **File → Export → HTML** (or `.ipynb`) and submit the file.
# MAGIC 3. Submit your 1-page findings summary with the signature block pasted at the bottom.