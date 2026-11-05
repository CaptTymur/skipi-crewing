    // EXPERIMENT (4), No.898: is `migration_required` reachable at all?
    //
    // The sibling test above proves a clean install with the PRODUCTION policy does NOT reach it.
    // This one asks the complementary question and answers it: the branch is reachable through
    // the EXISTING api, by the one input the single production caller never supplies. So the
    // guard is dead BY CALLER, not by construction - it protects a second caller that does not
    // exist yet, and it would come alive the day one does.
    #[test]
    fn native898_experiment4_migration_required_is_reachable_only_by_the_non_fresh_policy() {
        let fixture = JointFixture::new();
        let runtime = fixture.runtime(fixture.base_settings());
        assert_eq!(mode(&runtime.settings_arc().lock().unwrap(), &runtime_origins()), Mode::Unbound,
            "control: same clean install as the sibling test, or the two are not comparable");
        let context = runtime.context().unwrap();
        // The ONLY difference from the sibling test: the other policy.
        let pending = runtime.start_login(&context, CreationPolicy::ExistingOrUncertain).unwrap();
        let mut fake = Fake::default();
        fake.reply.connection.bearer_token = "skn_joint-next-company-credential".into();
        fake.reply.connection.expires_at = (now() + chrono::Duration::minutes(9)).to_rfc3339();
        let proof = runtime.authenticate(&fake, "joint@example.invalid", "synthetic-password", pending).unwrap();
        assert!(!proof.attempt.create,
            "control: this policy must NOT permit creation, or the experiment tests nothing");
        let outcome = fixture.apply(&runtime, proof, KeyFault::None, None);
        assert_eq!(outcome, Err("migration_required"),
            "the branch IS live: the same clean install reaches it when the policy is not FreshNativeContext");
        assert!(fixture.references.borrow().is_none(),
            "and nothing was allocated on the way to the refusal");
    }
