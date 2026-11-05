
    // No.930 RED-first. Утверждает ЦЕЛЬ карточки: успешный вход даёт ДЕЙСТВУЮЩУЮ приватную
    // сессию. Красен до продуктового варианта политики публикации — и красен ПО ПРОДУКТОВОЙ
    // причине: оракул наведён на `commit_local` (продуктовый путь, `PublicationPolicy::LocalOnly`),
    // а не на `foundation_apply`. Тест через cfg(test)-движок зелен уже сегодня и о продукте
    // не говорит ничего: `seed_native_session` берёт активность именно оттуда.
    // Утверждение — о НАБЛЮДАЕМОМ состоянии, а не о варианте `JointOutcome`: продуктовый
    // `LocalOutcome` активный коммит выразить не умеет (три варианта — Inactive, Blocked,
    // PublicationFailed), поэтому пин на вариант пришлось бы переписывать вместе с фиксом.
    #[test]
    fn native930_joint_successful_login_activates_private_session() {
        let fixture = JointFixture::new();
        let runtime = fixture.runtime(fixture.base_settings());
        // Контроль: до входа сессии нет. Без него зелёный мог бы прийти от предсуществующего
        // состояния фикстуры, а не от входа.
        assert_eq!(mode(&runtime.settings.lock().unwrap(), &runtime.origins()), Mode::Unbound,
            "control: the fixture must start as an unbound install");
        assert!(runtime.ticket(&runtime.context().unwrap()).is_err(),
            "control: no private session before the login");
        let proof = fixture.proof(&runtime, true);
        fixture.apply(&runtime, proof, KeyFault::None, None).unwrap();
        assert!(runtime.settings.lock().unwrap().native_authorized,
            "No.930: a successful login must authorize the native session");
        assert_eq!(mode(&runtime.settings.lock().unwrap(), &runtime.origins()), Mode::NativeSession,
            "No.930: the mode after a successful login must be NativeSession, not NativeLocked");
        assert_eq!(private_access(&runtime.settings.lock().unwrap(), &runtime.origins(),
            runtime.clock.now()), Ok(()),
            "No.930: account_session_state reads 'active' only when private_access is Ok");
        assert!(runtime.ticket(&runtime.context().unwrap()).is_ok(),
            "No.930: the activated session must be presentable as a ticket");
    }
