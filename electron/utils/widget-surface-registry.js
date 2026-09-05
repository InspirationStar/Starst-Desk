// ============================================================
// 小部件表面注册表 + 切换门池 + 提升事务（纯逻辑）
//        及配套类型：
//          - WidgetSurfaceDefinition（record）
//          - WidgetSurfaceSession<THost>
//          - WidgetSurfaceSwitchGatePool.cs
//          - WidgetSurfacePromotionTransaction.cs
// 职责：
//   1. 维护小部件表面（Surface）与物理宿主（Host）的运行时映射
//   2. 表面 ID 是稳定键；成员 ID 是查找别名（活动成员可切换）
//   3. 切换门池：每个表面 ID 对应一个独立信号量，跨 HWND 生命周期复用
//   4. 提升事务：把旧成员窗口一次性提升为统一 Surface 宿主的有序流程
// 类型映射：
//   C# THost : class           → JS 任意对象（引用语义，用 === 比对）
//   C# SemaphoreSlim(1, 1)     → JS Promise 互斥锁（基于链式 Promise）
//   C# IDisposable.Dispose     → JS dispose() 方法
//   C# lock _gate              → JS 串行调用约定（Node 单线程）
//   C# string Ordinal 比较    → JS ===
// 纯逻辑模块：不依赖 Vue/Electron，可独立单元测试
// ============================================================

// ------------------------------------------------------------
// 工具：参数校验
// ------------------------------------------------------------

/**
 * 校验非空字符串
 * @param {string} value
 * @param {string} name
 */
function throwIfNullOrWhiteSpace (value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    throw new Error(`${name} 不能为空字符串`)
  }
}

/**
 * 校验非空对象
 * @param {*} value
 * @param {string} name
 */
function throwIfNull (value, name) {
  if (value === null || value === undefined) {
    throw new Error(`${name} 不能为 null / undefined`)
  }
}

// ------------------------------------------------------------
// WidgetSurfaceDefinition：表面定义（值对象）
// ------------------------------------------------------------

/**
 * 创建表面定义
 * 对齐 C# sealed record WidgetSurfaceDefinition
 * @param {string} surfaceId - 表面 ID（稳定键）
 * @param {string|null} groupId - 所属组 ID
 * @param {string[]} memberIds - 成员 ID 列表（必须唯一，包含 activeMemberId）
 * @param {string} activeMemberId - 当前活动成员 ID
 * @returns {{surfaceId: string, groupId: string|null, memberIds: string[], activeMemberId: string}}
 */
function createSurfaceDefinition (surfaceId, groupId, memberIds, activeMemberId) {
  const definition = {
    surfaceId,
    groupId: groupId || null,
    memberIds: Array.isArray(memberIds) ? memberIds.slice() : [],
    activeMemberId
  }
  validateSurfaceDefinition(definition)
  return definition
}

/**
 * 校验表面定义
 * 移植自 C# WidgetSurfaceDefinition.Validate
 * @param {{surfaceId: string, groupId: string|null, memberIds: string[], activeMemberId: string}} definition
 */
function validateSurfaceDefinition (definition) {
  throwIfNull(definition, 'definition')
  throwIfNullOrWhiteSpace(definition.surfaceId, 'surfaceId')
  throwIfNullOrWhiteSpace(definition.activeMemberId, 'activeMemberId')
  if (!Array.isArray(definition.memberIds) || definition.memberIds.length === 0) {
    throw new Error('A surface definition requires unique members and a valid active member.')
  }
  for (const memberId of definition.memberIds) {
    if (typeof memberId !== 'string' || memberId.length === 0 || memberId.trim().length === 0) {
      throw new Error('A surface definition requires unique members and a valid active member.')
    }
  }
  // 唯一性检查
  const seen = new Set()
  for (const memberId of definition.memberIds) {
    if (seen.has(memberId)) {
      throw new Error('A surface definition requires unique members and a valid active member.')
    }
    seen.add(memberId)
  }
  // 活动成员必须在成员列表中
  if (!seen.has(definition.activeMemberId)) {
    throw new Error('A surface definition requires unique members and a valid active member.')
  }
}

// ------------------------------------------------------------
// WidgetSurfaceSession：表面会话
// ------------------------------------------------------------

/**
 * 创建表面会话
 * 对齐 C# sealed class WidgetSurfaceSession<THost>
 * @param {{surfaceId: string, groupId: string|null, memberIds: string[], activeMemberId: string}} definition
 * @param {*} host - 物理宿主
 * @returns {object} 会话对象
 */
function createSurfaceSession (definition, host) {
  return {
    surfaceId: definition.surfaceId,
    groupId: definition.groupId,
    memberIds: definition.memberIds.slice(),
    activeMemberId: definition.activeMemberId,
    host,
    candidateMemberId: null,
    candidateHost: null,
    switchGate: createSemaphore(),
    isDisposed: false
  }
}

/**
 * 抛出已释放异常
 * @param {object} session
 */
function throwIfSessionDisposed (session) {
  if (session.isDisposed) {
    throw new Error(`SurfaceSession '${session.surfaceId}' 已被释放`)
  }
}

/**
 * 更新会话定义
 * 移植自 C# WidgetSurfaceSession.UpdateDefinition
 * @param {object} session
 * @param {{groupId: string|null, memberIds: string[], activeMemberId: string}} definition
 */
function updateSessionDefinition (session, definition) {
  throwIfSessionDisposed(session)
  session.groupId = definition.groupId
  session.memberIds = definition.memberIds.slice()
  session.activeMemberId = definition.activeMemberId
  // 候选成员若已不在新成员列表，则清空
  if (session.candidateMemberId !== null &&
      !session.memberIds.includes(session.candidateMemberId)) {
    session.candidateMemberId = null
    session.candidateHost = null
  }
}

/**
 * 暂存候选宿主
 * 移植自 C# WidgetSurfaceSession.StageCandidate
 * @param {object} session
 * @param {string} targetMemberId
 * @param {*} candidateHost
 */
function stageSessionCandidate (session, targetMemberId, candidateHost) {
  throwIfSessionDisposed(session)
  session.candidateMemberId = targetMemberId
  session.candidateHost = candidateHost
}

/**
 * 取消候选宿主
 * 移植自 C# WidgetSurfaceSession.CancelCandidate
 * @param {object} session
 * @param {*} candidateHost
 * @returns {boolean}
 */
function cancelSessionCandidate (session, candidateHost) {
  throwIfSessionDisposed(session)
  if (session.candidateHost !== candidateHost) return false
  session.candidateMemberId = null
  session.candidateHost = null
  return true
}

/**
 * 提交活动宿主
 * 移植自 C# WidgetSurfaceSession.CommitActive
 * @param {object} session
 * @param {{groupId: string|null, memberIds: string[], activeMemberId: string}} definition
 * @param {*} host
 */
function commitSessionActive (session, definition, host) {
  throwIfSessionDisposed(session)
  session.groupId = definition.groupId
  session.memberIds = definition.memberIds.slice()
  session.activeMemberId = definition.activeMemberId
  session.host = host
  session.candidateMemberId = null
  session.candidateHost = null
}

/**
 * 释放会话
 * 移植自 C# WidgetSurfaceSession.Dispose
 * 注意：拓扑变化可能在取消后、in-flight 切换离开 finally 前收回注册表条目；
 *       保持门未释放可让持有者安全释放。此处仅标记 isDisposed。
 * @param {object} session
 */
function disposeSession (session) {
  if (session.isDisposed) return
  session.isDisposed = true
  session.candidateMemberId = null
  session.candidateHost = null
}

// ------------------------------------------------------------
// 简易信号量（基于 Promise 链）
// 对齐 C# SemaphoreSlim(1, 1)
// ------------------------------------------------------------

/**
 * 创建一个互斥信号量
 * @returns {{acquire: function(): Promise<function(): void>}}
 */
function createSemaphore () {
  let tail = Promise.resolve()
  return {
    /**
     * 获取释放函数；await acquire() 后调用返回的 release() 释放锁
     * @returns {Promise<function(): void>}
     */
    async acquire () {
      const oldTail = tail
      let release
      tail = new Promise((resolve) => { release = resolve })
      await oldTail
      return () => release()
    }
  }
}

// ------------------------------------------------------------
// WidgetSurfaceRegistry：表面注册表
// ------------------------------------------------------------

/**
 * 创建表面注册表
 * 移植自 C# sealed class WidgetSurfaceRegistry<THost>
 * @returns {object} 注册表实例
 */
function createSurfaceRegistry () {
  // surfaceId -> session
  const sessions = new Map()
  // memberId -> surfaceId
  const surfaceIdByMemberId = new Map()

  /**
   * 索引成员
   * @param {{surfaceId: string, memberIds: string[]}} definition
   */
  function indexMembers (definition) {
    for (const memberId of definition.memberIds) {
      surfaceIdByMemberId.set(memberId, definition.surfaceId)
    }
  }

  /**
   * 移除被其他表面声索的成员
   * 移植自 C# RemoveMemberClaims
   * @param {string[]} memberIds
   * @param {string} exceptSurfaceId
   */
  function removeMemberClaims (memberIds, exceptSurfaceId) {
    for (const memberId of memberIds) {
      const claimedSurfaceId = surfaceIdByMemberId.get(memberId)
      if (!claimedSurfaceId || claimedSurfaceId === exceptSurfaceId) continue

      const claimedSession = sessions.get(claimedSurfaceId)
      if (claimedSession) {
        sessions.delete(claimedSurfaceId)
        removeIndexedMembers(claimedSession.memberIds, claimedSession.surfaceId)
        disposeSession(claimedSession)
      } else {
        surfaceIdByMemberId.delete(memberId)
      }
    }
  }

  /**
   * 移除已索引成员
   * 移植自 C# RemoveIndexedMembers
   * @param {string[]} memberIds
   * @param {string} surfaceId
   */
  function removeIndexedMembers (memberIds, surfaceId) {
    for (const memberId of memberIds) {
      const indexedSurfaceId = surfaceIdByMemberId.get(memberId)
      if (indexedSurfaceId === surfaceId) {
        surfaceIdByMemberId.delete(memberId)
      }
    }
  }

  /**
   * 重建成员索引
   * 移植自 C# ReindexMembers
   * @param {string[]} previousMemberIds
   * @param {{surfaceId: string, memberIds: string[]}} definition
   */
  function reindexMembers (previousMemberIds, definition) {
    removeIndexedMembers(previousMemberIds, definition.surfaceId)
    removeMemberClaims(definition.memberIds, definition.surfaceId)
    indexMembers(definition)
  }

  return {
    /**
     * 当前表面数
     * 对齐 C# Count
     * @returns {number}
     */
    get count () {
      return sessions.size
    },

    /**
     * 获取所有会话快照
     * 对齐 C# GetSessions
     * @returns {object[]}
     */
    getSessions () {
      return Array.from(sessions.values())
    },

    /**
     * 注册活动宿主
     * 移植自 C# RegisterActive
     * @param {{surfaceId: string, groupId: string|null, memberIds: string[], activeMemberId: string}} definition
     * @param {*} host
     * @returns {object} 会话
     */
    registerActive (definition, host) {
      throwIfNull(definition, 'definition')
      throwIfNull(host, 'host')
      validateSurfaceDefinition(definition)

      const existing = sessions.get(definition.surfaceId)
      if (existing) {
        if (existing.host !== host) {
          throw new Error(`Surface '${definition.surfaceId}' already owns another active host.`)
        }
        reindexMembers(existing.memberIds, definition)
        updateSessionDefinition(existing, definition)
        return existing
      }

      removeMemberClaims(definition.memberIds, definition.surfaceId)
      const session = createSurfaceSession(definition, host)
      sessions.set(definition.surfaceId, session)
      indexMembers(definition)
      return session
    },

    /**
     * 与已稳定的运行时宿主同步
     * 移植自 C# SynchronizeActive
     * 用于恢复和组拓扑变化后，不作为切换提交路径
     * @param {{surfaceId: string, groupId: string|null, memberIds: string[], activeMemberId: string}} definition
     * @param {*} host
     * @returns {object} 会话
     */
    synchronizeActive (definition, host) {
      throwIfNull(definition, 'definition')
      throwIfNull(host, 'host')
      validateSurfaceDefinition(definition)

      const existing = sessions.get(definition.surfaceId)
      if (existing) {
        reindexMembers(existing.memberIds, definition)
        commitSessionActive(existing, definition, host)
        return existing
      }

      removeMemberClaims(definition.memberIds, definition.surfaceId)
      const session = createSurfaceSession(definition, host)
      sessions.set(definition.surfaceId, session)
      indexMembers(definition)
      return session
    },

    /**
     * 暂存候选宿主
     * 移植自 C# StageCandidate
     * @param {string} surfaceId
     * @param {string} targetMemberId
     * @param {*} candidateHost
     * @returns {boolean}
     */
    stageCandidate (surfaceId, targetMemberId, candidateHost) {
      throwIfNullOrWhiteSpace(surfaceId, 'surfaceId')
      throwIfNullOrWhiteSpace(targetMemberId, 'targetMemberId')
      throwIfNull(candidateHost, 'candidateHost')

      const session = sessions.get(surfaceId)
      if (!session || !session.memberIds.includes(targetMemberId)) return false
      stageSessionCandidate(session, targetMemberId, candidateHost)
      return true
    },

    /**
     * 提交活动宿主
     * 移植自 C# CommitActive
     * @param {{surfaceId: string, groupId: string|null, memberIds: string[], activeMemberId: string}} definition
     * @param {*} host
     * @returns {object} 会话
     */
    commitActive (definition, host) {
      throwIfNull(definition, 'definition')
      throwIfNull(host, 'host')
      validateSurfaceDefinition(definition)

      const session = sessions.get(definition.surfaceId)
      if (!session) {
        return this.registerActive(definition, host)
      }

      if (session.host !== host &&
          (session.candidateHost !== host ||
           session.candidateMemberId !== definition.activeMemberId)) {
        throw new Error(`Host was not prepared for surface '${definition.surfaceId}'.`)
      }

      reindexMembers(session.memberIds, definition)
      commitSessionActive(session, definition, host)
      return session
    },

    /**
     * 取消候选宿主
     * 移植自 C# CancelCandidate
     * @param {string} surfaceId
     * @param {*} candidateHost
     * @returns {boolean}
     */
    cancelCandidate (surfaceId, candidateHost) {
      throwIfNullOrWhiteSpace(surfaceId, 'surfaceId')
      throwIfNull(candidateHost, 'candidateHost')
      const session = sessions.get(surfaceId)
      return !!session && cancelSessionCandidate(session, candidateHost)
    },

    /**
     * 更新定义
     * 移植自 C# UpdateDefinition
     * @param {{surfaceId: string, groupId: string|null, memberIds: string[], activeMemberId: string}} definition
     * @returns {boolean}
     */
    updateDefinition (definition) {
      throwIfNull(definition, 'definition')
      validateSurfaceDefinition(definition)
      const session = sessions.get(definition.surfaceId)
      if (!session) return false
      reindexMembers(session.memberIds, definition)
      updateSessionDefinition(session, definition)
      return true
    },

    /**
     * 按表面 ID 查找
     * 移植自 C# TryGet
     * @param {string} surfaceId
     * @returns {object|null}
     */
    tryGet (surfaceId) {
      if (typeof surfaceId !== 'string' || surfaceId.length === 0 || surfaceId.trim().length === 0) {
        return null
      }
      return sessions.get(surfaceId) || null
    },

    /**
     * 按成员 ID 查找
     * 移植自 C# TryGetByMember
     * @param {string} memberId
     * @returns {object|null}
     */
    tryGetByMember (memberId) {
      if (typeof memberId !== 'string' || memberId.length === 0 || memberId.trim().length === 0) {
        return null
      }
      const surfaceId = surfaceIdByMemberId.get(memberId)
      if (!surfaceId) return null
      return sessions.get(surfaceId) || null
    },

    /**
     * 移除表面
     * 移植自 C# RemoveSurface
     * @param {string} surfaceId
     * @returns {boolean}
     */
    removeSurface (surfaceId) {
      if (typeof surfaceId !== 'string' || surfaceId.length === 0 || surfaceId.trim().length === 0) {
        return false
      }
      const session = sessions.get(surfaceId)
      if (!session) return false
      sessions.delete(surfaceId)
      removeIndexedMembers(session.memberIds, surfaceId)
      disposeSession(session)
      return true
    },

    /**
     * 注销指定宿主的所有表面
     * 移植自 C# UnregisterHost
     * @param {*} host
     * @returns {number} 移除的表面数
     */
    unregisterHost (host) {
      throwIfNull(host, 'host')
      let removed = 0
      for (const session of Array.from(sessions.values())) {
        if (session.candidateHost === host) {
          cancelSessionCandidate(session, host)
        }
        if (session.host !== host) continue
        sessions.delete(session.surfaceId)
        removeIndexedMembers(session.memberIds, session.surfaceId)
        disposeSession(session)
        removed++
      }
      return removed
    },

    /**
     * 清空所有表面
     * 移植自 C# Clear
     */
    clear () {
      for (const session of sessions.values()) {
        disposeSession(session)
      }
      sessions.clear()
      surfaceIdByMemberId.clear()
    }
  }
}

// ------------------------------------------------------------
// WidgetSurfaceSwitchGatePool：切换门池
// ------------------------------------------------------------

/**
 * 创建切换门池
 * 移植自 C# sealed class WidgetSurfaceSwitchGatePool
 * 每个 surfaceId 对应一个独立信号量，跨 HWND 生命周期复用
 * @returns {object}
 */
function createSwitchGatePool () {
  const gates = new Map()
  return {
    /**
     * 获取指定表面的切换门
     * 对齐 C# Get
     * @param {string} surfaceId
     * @returns {{acquire: function(): Promise<function(): void>}}
     */
    get (surfaceId) {
      throwIfNullOrWhiteSpace(surfaceId, 'surfaceId')
      let gate = gates.get(surfaceId)
      if (!gate) {
        gate = createSemaphore()
        gates.set(surfaceId, gate)
      }
      return gate
    }
  }
}

// ------------------------------------------------------------
// WidgetSurfacePromotionTransaction：表面提升事务
// ------------------------------------------------------------

/**
 * 执行表面提升事务（异步版本）
 * 移植自 C# WidgetSurfacePromotionTransaction.ExecuteAsync（异步重载）
 * 流程：prepareCandidate → presentCandidate → commitAndRetireLegacy；失败则 rollbackCandidate
 * @param {function(): Promise<*>} prepareCandidateAsync
 * @param {function(*): Promise<void>} presentCandidateAsync
 * @param {function(*): Promise<void>} commitAndRetireLegacyAsync
 * @param {function(*): void} rollbackCandidate
 * @param {function(string): void} [logFn] - 日志函数
 * @returns {Promise<*>} 候选结果
 */
async function executePromotionTransactionAsync (
  prepareCandidateAsync,
  presentCandidateAsync,
  commitAndRetireLegacyAsync,
  rollbackCandidate,
  logFn
) {
  throwIfNull(prepareCandidateAsync, 'prepareCandidateAsync')
  throwIfNull(presentCandidateAsync, 'presentCandidateAsync')
  throwIfNull(commitAndRetireLegacyAsync, 'commitAndRetireLegacyAsync')
  throwIfNull(rollbackCandidate, 'rollbackCandidate')

  const log = typeof logFn === 'function' ? logFn : () => {}
  const candidate = await prepareCandidateAsync()
  try {
    await presentCandidateAsync(candidate)
    await commitAndRetireLegacyAsync(candidate)
    return candidate
  } catch (err) {
    try {
      rollbackCandidate(candidate)
    } catch (rollbackException) {
      log(`[WidgetSurface] Promotion candidate rollback failed: ${rollbackException}`)
    }
    throw err
  }
}

/**
 * 执行表面提升事务（同步 present / commit 版本）
 * 移植自 C# WidgetSurfacePromotionTransaction.ExecuteAsync（同步重载）
 * @param {function(): Promise<*>} prepareCandidateAsync
 * @param {function(*): void} presentCandidate
 * @param {function(*): void} commitAndRetireLegacy
 * @param {function(*): void} rollbackCandidate
 * @param {function(string): void} [logFn]
 * @returns {Promise<*>}
 */
async function executePromotionTransactionSync (
  prepareCandidateAsync,
  presentCandidate,
  commitAndRetireLegacy,
  rollbackCandidate,
  logFn
) {
  throwIfNull(prepareCandidateAsync, 'prepareCandidateAsync')
  throwIfNull(presentCandidate, 'presentCandidate')
  throwIfNull(commitAndRetireLegacy, 'commitAndRetireLegacy')
  throwIfNull(rollbackCandidate, 'rollbackCandidate')

  const log = typeof logFn === 'function' ? logFn : () => {}
  const candidate = await prepareCandidateAsync()
  try {
    presentCandidate(candidate)
    commitAndRetireLegacy(candidate)
    return candidate
  } catch (err) {
    try {
      rollbackCandidate(candidate)
    } catch (rollbackException) {
      log(`[WidgetSurface] Promotion candidate rollback failed: ${rollbackException}`)
    }
    throw err
  }
}

// ------------------------------------------------------------
// 模块导出
// ------------------------------------------------------------

module.exports = {
  // 表面定义
  createSurfaceDefinition,
  validateSurfaceDefinition,
  // 表面会话
  createSurfaceSession,
  updateSessionDefinition,
  stageSessionCandidate,
  cancelSessionCandidate,
  commitSessionActive,
  disposeSession,
  // 信号量
  createSemaphore,
  // 表面注册表
  createSurfaceRegistry,
  // 切换门池
  createSwitchGatePool,
  // 提升事务
  executePromotionTransactionAsync,
  executePromotionTransactionSync
}