(function () {
  var STORAGE_KEY = "todoReflectionSingleFileApp";
  var DAY_MS = 86400000;

  function createId() {
    return "item-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
  }

  function isDateKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + "T00:00:00").getTime());
  }

  function isValidDate(value) {
    return !!value && !Number.isNaN(new Date(value).getTime());
  }

  function localState() {
    var fallback = { theme: "pink", anniversaries: [], pendingAnniversaryIds: [], todos: [], journal: [] };
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {};
      var legacy = isDateKey(parsed.anniversaryDate) ? [{ id: createId(), title: "在一起", date: parsed.anniversaryDate }] : [];
      return {
        theme: parsed.theme === "blue" ? "blue" : "pink",
        anniversaries: (Array.isArray(parsed.anniversaries) ? parsed.anniversaries : legacy).map(function (item) {
          return { id: item.id || createId(), title: typeof item.title === "string" ? item.title.trim() : "", date: item.date || item.anniversary_date };
        }).filter(function (item) { return item.title && isDateKey(item.date); }),
        pendingAnniversaryIds: Array.isArray(parsed.pendingAnniversaryIds) ? parsed.pendingAnniversaryIds : [],
        todos: Array.isArray(parsed.todos) ? parsed.todos : [],
        journal: Array.isArray(parsed.journal) ? parsed.journal : []
      };
    } catch (error) {
      return fallback;
    }
  }

  function persistState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function dateAtMidnight(value) {
    if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (isDateKey(value)) return new Date(value + "T00:00:00");
    var date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function dateDifference(value) {
    return Math.floor((dateAtMidnight(new Date()).getTime() - dateAtMidnight(value).getTime()) / DAY_MS);
  }

  function formatDateLabel(value) {
    var date = isDateKey(value) ? value.split("-") : null;
    if (!date) return "未记录日期";
    return date[0] + "年" + date[1] + "月" + date[2] + "日";
  }

  function formatDateTime(value) {
    if (!isValidDate(value)) return "未记录时间";
    var date = new Date(value);
    var pad = function (number) { return String(number).padStart(2, "0"); };
    return date.getFullYear() + "年" + pad(date.getMonth() + 1) + "月" + pad(date.getDate()) + "日 " + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function todoToCloudRow(todo, userId) {
    return { id: todo.id, text: todo.text, note: todo.note || "", status: "pending", created_by: userId, created_at: todo.createdAt, restored_at: todo.restoredAt || null, completed_at: null };
  }

  function journalToCloudRow(entry, userId) {
    return { id: entry.id, text: entry.text, note: entry.note || "", status: "completed", created_by: userId, created_at: entry.createdAt, restored_at: null, completed_at: entry.completedAt };
  }

  function anniversaryToCloudRow(item) {
    return { id: item.id, title: item.title, anniversary_date: item.date };
  }

  function cloudConfigured() {
    var config = window.TWO_PERSON_APP_CONFIG || {};
    return !!(config.supabaseUrl && config.supabasePublishableKey && config.sharedLoginEmail && config.supabaseUrl.indexOf("YOUR_PROJECT") === -1 && config.supabasePublishableKey.indexOf("YOUR_") === -1 && config.sharedLoginEmail.indexOf("example.com") === -1);
  }

  function init(options) {
    var config = window.TWO_PERSON_APP_CONFIG || {};
    var elements = options.elements || {};
    var cloud = { enabled: false, client: null, user: null, channel: null, loading: false };
    var state = localState();

    function setSync(status) {
      if (!elements.syncState) return;
      elements.syncState.hidden = !cloud.enabled;
      elements.syncState.classList.toggle("is-online", status === "online");
      elements.syncState.classList.toggle("is-error", status === "error");
      elements.syncState.title = status === "online" ? "已同步" : status === "error" ? "同步失败" : status === "connecting" ? "正在连接云端" : "等待登录";
    }

    function showGate(message, isError) {
      if (!elements.authGate) return;
      elements.authGate.classList.add("is-open");
      if (elements.authMessage) {
        elements.authMessage.textContent = message || "";
        elements.authMessage.classList.toggle("is-error", !!isError);
      }
      if (elements.signOutButton) elements.signOutButton.hidden = true;
      if (elements.syncState) elements.syncState.hidden = true;
      if (elements.passwordInput) window.setTimeout(function () { elements.passwordInput.focus(); }, 0);
    }

    function hideGate() {
      if (elements.authGate) elements.authGate.classList.remove("is-open");
      if (elements.signOutButton) elements.signOutButton.hidden = !cloud.enabled;
      if (elements.syncState) elements.syncState.hidden = !cloud.enabled;
    }

    function localPayload() {
      return {
        source: "local",
        state: state,
        personOne: "你",
        personTwo: "TA",
        anniversaries: state.anniversaries.slice(),
        memories: state.journal.slice()
      };
    }

    function cloudPayload(settings, todos, anniversaries) {
      return {
        source: "cloud",
        state: state,
        personOne: settings.person_one || "你",
        personTwo: settings.person_two || "TA",
        anniversaries: anniversaries.map(function (row) { return { id: row.id, title: row.title, date: row.anniversary_date }; }),
        memories: todos.filter(function (row) { return row.status === "completed" && isValidDate(row.completed_at); }).map(function (row) {
          return { id: row.id, text: row.text, note: row.note || "", createdAt: row.created_at, completedAt: row.completed_at };
        })
      };
    }

    function loadCloudData() {
      if (!cloud.client || !cloud.user) return Promise.resolve(false);
      return Promise.all([
        cloud.client.from("app_settings").select("person_one,person_two").eq("id", true).maybeSingle(),
        cloud.client.from("todos").select("id,text,note,status,created_at,restored_at,completed_at").order("updated_at", { ascending: false }),
        cloud.client.from("anniversaries").select("id,title,anniversary_date").order("anniversary_date", { ascending: true })
      ]).then(function (results) {
        var settingsResult = results[0];
        var todoResult = results[1];
        var anniversaryResult = results[2];
        if (settingsResult.error || !settingsResult.data) {
          showGate("这个账号没有访问权限", true);
          if (cloud.client) cloud.client.auth.signOut();
          return false;
        }
        if (todoResult.error || anniversaryResult.error) {
          setSync("error");
          if (options.onError) options.onError("云端数据读取失败");
          return false;
        }
        var remoteAnniversaries = anniversaryResult.data.map(function (row) { return { id: row.id, title: row.title, date: row.anniversary_date }; });
        var remoteIds = {};
        remoteAnniversaries.forEach(function (item) { remoteIds[item.id] = true; });
        var pendingIds = state.pendingAnniversaryIds || [];
        var localOnly = state.anniversaries.filter(function (item) { return !remoteIds[item.id] && (remoteAnniversaries.length === 0 || pendingIds.indexOf(item.id) !== -1); });
        state.anniversaries = remoteAnniversaries.concat(localOnly);
        state.todos = todoResult.data.filter(function (row) { return row.status === "pending"; }).map(function (row) { return { id: row.id, text: row.text, note: row.note || "", createdAt: row.created_at, restoredAt: row.restored_at || null }; });
        state.journal = todoResult.data.filter(function (row) { return row.status === "completed"; }).map(function (row) { return { id: row.id, text: row.text, note: row.note || "", createdAt: row.created_at, completedAt: row.completed_at }; });
        persistState(state);
        options.onData(cloudPayload(settingsResult.data, todoResult.data, state.anniversaries.map(function (item) { return { id: item.id, title: item.title, anniversary_date: item.date }; })));
        if (localOnly.length) {
          cloud.client.from("anniversaries").insert(localOnly.map(anniversaryToCloudRow)).then(function (result) {
            if (!result.error) {
              state.pendingAnniversaryIds = (state.pendingAnniversaryIds || []).filter(function (id) { return !localOnly.some(function (item) { return item.id === id; }); });
              persistState(state);
            }
          });
        }
        setSync("online");
        return true;
      }).catch(function () {
        setSync("error");
        if (options.onError) options.onError("云端数据读取失败");
        return false;
      });
    }

    function migrateLocalData() {
      if (!cloud.client || !cloud.user || localStorage.getItem("todoReflectionCloudMigrationV2")) return Promise.resolve();
      var todoRows = state.todos.map(function (todo) { return todoToCloudRow(todo, cloud.user.id); }).concat(state.journal.map(function (entry) { return journalToCloudRow(entry, cloud.user.id); }));
      var anniversaryRows = state.anniversaries.map(anniversaryToCloudRow);
      return Promise.all([cloud.client.from("todos").select("id"), cloud.client.from("anniversaries").select("id")]).then(function (results) {
        if (results[0].error) return;
        var existingTodos = {};
        var existingAnniversaries = {};
        results[0].data.forEach(function (row) { existingTodos[row.id] = true; });
        if (!results[1].error) results[1].data.forEach(function (row) { existingAnniversaries[row.id] = true; });
        var missingTodos = todoRows.filter(function (row) { return !existingTodos[row.id]; });
        var missingAnniversaries = anniversaryRows.filter(function (row) { return !existingAnniversaries[row.id]; });
        var uploads = [];
        if (missingTodos.length) uploads.push(cloud.client.from("todos").insert(missingTodos));
        if (missingAnniversaries.length) uploads.push(cloud.client.from("anniversaries").insert(missingAnniversaries));
        return Promise.all(uploads).then(function (responses) {
          if (responses.every(function (response) { return !response.error; })) localStorage.setItem("todoReflectionCloudMigrationV2", "1");
        });
      });
    }

    function subscribe() {
      if (!cloud.client) return;
      if (cloud.channel) cloud.client.removeChannel(cloud.channel);
      cloud.channel = cloud.client.channel("private-space-" + (options.channelName || "detail"))
        .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, function () { loadCloudData(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "anniversaries" }, function () { loadCloudData(); })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_settings" }, function () { loadCloudData(); })
        .subscribe(function (status) {
          if (status === "SUBSCRIBED") setSync("online");
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSync("error");
        });
    }

    function handleSession(session) {
      cloud.user = session && session.user ? session.user : null;
      if (!cloud.user) {
        cloud.loading = false;
        showGate("", false);
        setSync("offline");
        return;
      }
      if (cloud.loading) return;
      cloud.loading = true;
      migrateLocalData().then(function () { return loadCloudData(); }).then(function (allowed) {
        if (allowed) {
          hideGate();
          if (options.onReady) options.onReady({ cloud: cloud });
          subscribe();
        }
      }).finally(function () { cloud.loading = false; });
    }

    function signIn(event) {
      event.preventDefault();
      if (!cloud.client || !elements.passwordInput) return;
      var password = elements.passwordInput.value;
      if (!password) return;
      if (elements.authButton) elements.authButton.disabled = true;
      if (elements.authMessage) {
        elements.authMessage.classList.remove("is-error");
        elements.authMessage.textContent = "正在进入";
      }
      cloud.client.auth.signInWithPassword({ email: config.sharedLoginEmail.toLowerCase(), password: password }).then(function (result) {
        if (result.error) throw result.error;
        elements.passwordInput.value = "";
      }).catch(function () {
        if (elements.authMessage) {
          elements.authMessage.classList.add("is-error");
          elements.authMessage.textContent = "密码不对，再想想看";
        }
      }).finally(function () { if (elements.authButton) elements.authButton.disabled = false; });
    }

    function start() {
      if (!cloudConfigured() || !window.supabase || typeof window.supabase.createClient !== "function") {
        options.onData(localPayload());
        if (options.onReady) options.onReady({ cloud: cloud });
        return;
      }
      cloud.enabled = true;
      cloud.client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
      setSync("connecting");
      if (elements.authForm) elements.authForm.addEventListener("submit", signIn);
      if (elements.signOutButton) elements.signOutButton.addEventListener("click", function () { cloud.client.auth.signOut(); });
      cloud.client.auth.onAuthStateChange(function (event, session) { window.setTimeout(function () { handleSession(session); }, 0); });
      cloud.client.auth.getSession().then(function (result) { handleSession(result.data.session); });
    }

    return {
      state: state,
      cloud: cloud,
      start: start,
      refresh: loadCloudData,
      persist: function () { persistState(state); },
      write: function (promise) {
        if (!cloud.enabled || !cloud.user) return Promise.resolve();
        return promise.then(function (result) {
          if (result && result.error) {
            setSync("error");
            if (options.onError) options.onError("云端同步失败");
          }
          return result;
        }).catch(function () {
          setSync("error");
          if (options.onError) options.onError("云端同步失败");
        });
      },
      formatDateLabel: formatDateLabel,
      formatDateTime: formatDateTime,
      dateDifference: dateDifference,
      persistState: persistState,
      createId: createId
    };
  }

  window.TwoPersonPages = {
    init: init,
    readState: localState,
    persistState: persistState,
    formatDateLabel: formatDateLabel,
    formatDateTime: formatDateTime,
    dateDifference: dateDifference,
    createId: createId,
    isDateKey: isDateKey
  };
})();
